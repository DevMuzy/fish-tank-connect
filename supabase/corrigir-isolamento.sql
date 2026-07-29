-- ============================================================================
-- CORRIGE O ISOLAMENTO ENTRE EMPRESAS
--
-- Sintoma: os três painéis enxergam os mesmos clientes. A RLS está ligada
-- (usuário anônimo não lê nada), mas o role `authenticated` lê tudo — o que só
-- acontece se sobrou alguma policy antiga com `USING (true)`. No Postgres,
-- policies permissivas se SOMAM: basta uma liberando tudo para as outras
-- perderem o efeito.
--
-- Cole INTEIRO no SQL Editor. Ao final ele imprime duas tabelas de conferência.
-- Idempotente.
-- ============================================================================

-- PASSO 1 — Fotografa o que existe hoje, para sabermos o que estava errado.
DROP TABLE IF EXISTS _policies_antes;
CREATE TEMP TABLE _policies_antes AS
SELECT tablename, policyname, roles::text AS roles, cmd, qual::text AS usando
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('clientes','mensagens','historico_envios','integracoes_whatsapp',
                     'empresas','usuarios_empresas');

-- PASSO 2 — Remove TODAS as policies dessas tabelas.
--
-- Diferente da tentativa anterior: os nomes são coletados num array ANTES de
-- qualquer DROP. Dropar enquanto se percorre um cursor sobre `pg_policies` pode
-- deixar entradas para trás, e uma única sobrevivente com `USING (true)`
-- reabre o acesso a tudo.
DO $$
DECLARE
  v_tabela TEXT;
  v_nomes  TEXT[];
  v_nome   TEXT;
BEGIN
  FOREACH v_tabela IN ARRAY ARRAY['clientes','mensagens','historico_envios',
                                  'integracoes_whatsapp','empresas','usuarios_empresas']
  LOOP
    SELECT array_agg(policyname) INTO v_nomes
      FROM pg_policies WHERE schemaname = 'public' AND tablename = v_tabela;

    IF v_nomes IS NOT NULL THEN
      FOREACH v_nome IN ARRAY v_nomes LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_nome, v_tabela);
        RAISE NOTICE 'removida: %.%', v_tabela, v_nome;
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- PASSO 3 — Garante que a função de contexto existe e está correta.
CREATE OR REPLACE FUNCTION public.empresa_do_usuario()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT empresa_id FROM public.usuarios_empresas WHERE user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.empresa_do_usuario() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresa_do_usuario() TO authenticated;

-- PASSO 4 — Recria as policies, uma por tabela, nomeadas de forma única.
DO $$
DECLARE v_tabela TEXT;
BEGIN
  FOREACH v_tabela IN ARRAY ARRAY['clientes','mensagens','historico_envios','integracoes_whatsapp']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tabela);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR ALL TO authenticated
        USING      (empresa_id = (SELECT public.empresa_do_usuario()))
        WITH CHECK (empresa_id = (SELECT public.empresa_do_usuario()))
    $f$, 'rls_' || v_tabela || '_empresa', v_tabela);
    RAISE NOTICE 'policy criada em %', v_tabela;
  END LOOP;
END $$;

ALTER TABLE public.empresas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios_empresas ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_empresas_propria ON public.empresas
  FOR SELECT TO authenticated
  USING (id = (SELECT public.empresa_do_usuario()));

CREATE POLICY rls_usuarios_empresas_proprio ON public.usuarios_empresas
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ============================================================================
-- CONFERÊNCIA 1 — o que existia ANTES.
-- Qualquer linha com `usando` = "true" era o furo.
-- ============================================================================
SELECT tablename AS tabela, policyname AS policy, roles, cmd AS operacao, usando
  FROM _policies_antes
 ORDER BY tablename, policyname;

-- ============================================================================
-- CONFERÊNCIA 2 — o que existe AGORA.
-- Espere exatamente 6 linhas, e NENHUMA com `usando` = "true".
-- ============================================================================
SELECT tablename AS tabela, policyname AS policy, roles, cmd AS operacao,
       qual::text AS usando
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('clientes','mensagens','historico_envios','integracoes_whatsapp',
                     'empresas','usuarios_empresas')
 ORDER BY tablename, policyname;
