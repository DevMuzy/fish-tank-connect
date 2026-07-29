-- ============================================================================
-- Multi-tenant: um banco, vários clientes (Ambientar Móveis, Império Joias, …)
--
-- Antes desta migration o banco era de um cliente só: TODAS as policies eram
-- `USING (true)`, então qualquer usuário autenticado enxergava e editava os
-- dados de qualquer outro. Colocar um segundo cliente no mesmo projeto sem
-- isto significaria a Império abrindo o painel com a base da Ambientar.
--
-- O isolamento mora no Postgres, não no front: os server functions usam a
-- chave publishable com o JWT do usuário (role `authenticated`), então a RLS
-- é a fronteira real. Bug no front não vaza dado de ninguém.
--
-- Idempotente — pode rodar mais de uma vez no SQL Editor.
--
-- IMPORTANTE: este script vale para os DOIS repositórios (Ambientar e Império),
-- porque o banco é o mesmo. Rode uma vez só, e copie o arquivo para o outro
-- repo para o histórico de migrations não divergir.
-- ============================================================================

-- Necessário para criar o login da Império no fim do script.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ------------------------------------------------------------- EMPRESAS --
CREATE TABLE IF NOT EXISTS public.empresas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT NOT NULL UNIQUE,          -- casa com VITE_EMPRESA_SLUG do deploy
  nome       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Espaçamento entre um envio e o próximo. Mora no banco, e não numa constante
-- de código, porque cada cliente tem seu próprio repositório: como constante
-- ela divergiria na primeira vez que alguém editasse um repo e esquecesse os
-- outros. Aqui é um valor só, e todo painel lê o mesmo.
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS delay_envio_ms INTEGER NOT NULL DEFAULT 12000;

ALTER TABLE public.empresas
  DROP CONSTRAINT IF EXISTS empresas_delay_minimo;
ALTER TABLE public.empresas
  ADD CONSTRAINT empresas_delay_minimo CHECK (delay_envio_ms >= 12000);

-- O slug é identificador interno e não aparece em tela.
INSERT INTO public.empresas (slug, nome) VALUES
  ('ambientar',     'Ambientar Móveis'),
  ('imperio-joias', 'Império Bolsas & Acessórios'),
  ('vitoria-mar',   'Peixaria Vitória Mar')
ON CONFLICT (slug) DO NOTHING;

-- Reforça o piso de 12s mesmo em linha criada antes desta migration.
UPDATE public.empresas SET delay_envio_ms = 12000 WHERE delay_envio_ms < 12000;

-- --------------------------------------------------- VÍNCULO USUÁRIO → EMPRESA --
-- Um login pertence a exatamente uma empresa (PK em user_id). Se alguém
-- precisar dos dois painéis, ganha dois logins — é mais simples de auditar do
-- que um seletor de empresa na tela, e evita a classe de bug em que o usuário
-- dispara para a base errada por ter esquecido qual contexto estava ativo.
CREATE TABLE IF NOT EXISTS public.usuarios_empresas (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usuarios_empresas_empresa ON public.usuarios_empresas (empresa_id);

-- Empresa do usuário logado.
--
-- SECURITY DEFINER porque esta função é chamada de dentro das policies das
-- outras tabelas: se ela lesse `usuarios_empresas` com os privilégios do
-- chamador, a RLS daquela tabela dispararia durante a avaliação da RLS desta,
-- e o Postgres entraria em recursão infinita.
--
-- Retorna NULL para usuário sem vínculo — e `empresa_id = NULL` é NULL (não
-- TRUE), então as policies negam tudo. Usuário novo nasce sem ver nada, que é
-- o comportamento seguro.
CREATE OR REPLACE FUNCTION public.empresa_do_usuario()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT empresa_id FROM public.usuarios_empresas WHERE user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.empresa_do_usuario() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresa_do_usuario() TO authenticated;

GRANT SELECT ON public.empresas TO authenticated;
GRANT SELECT ON public.usuarios_empresas TO authenticated;
GRANT ALL ON public.empresas TO service_role;
GRANT ALL ON public.usuarios_empresas TO service_role;

ALTER TABLE public.empresas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios_empresas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ver a própria empresa" ON public.empresas;
CREATE POLICY "Ver a própria empresa" ON public.empresas
  FOR SELECT TO authenticated
  USING (id = (SELECT public.empresa_do_usuario()));

DROP POLICY IF EXISTS "Ver o próprio vínculo" ON public.usuarios_empresas;
CREATE POLICY "Ver o próprio vínculo" ON public.usuarios_empresas
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Ninguém edita vínculo pelo painel: sem policy de INSERT/UPDATE/DELETE, só o
-- service_role (SQL Editor) muda quem pertence a qual empresa.

-- ---------------------------------------------- COLUNA empresa_id NAS TABELAS --
-- Backfill: tudo que existe hoje no banco é da Ambientar — ela era a única
-- inquilina até agora.
DO $$
DECLARE
  v_ambientar UUID;
  v_tabela    TEXT;
BEGIN
  SELECT id INTO v_ambientar FROM public.empresas WHERE slug = 'ambientar';

  FOREACH v_tabela IN ARRAY ARRAY['clientes', 'mensagens', 'historico_envios', 'integracoes_whatsapp']
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES public.empresas(id) ON DELETE RESTRICT',
      v_tabela);
    EXECUTE format('UPDATE public.%I SET empresa_id = $1 WHERE empresa_id IS NULL', v_tabela)
      USING v_ambientar;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN empresa_id SET NOT NULL', v_tabela);

    -- DEFAULT resolvido no banco: assim os INSERTs do app (CampaignService,
    -- cadastro de cliente, integrações) continuam sem passar empresa_id, e
    -- não existe caminho de código capaz de esquecer de preencher.
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN empresa_id SET DEFAULT public.empresa_do_usuario()',
      v_tabela);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%s_empresa ON public.%I (empresa_id)',
      v_tabela, v_tabela);
  END LOOP;
END $$;

-- ------------------------------------------------- UNIQUES QUE ERAM GLOBAIS --
-- `clientes.telefone` era UNIQUE no banco inteiro: a Império não conseguiria
-- cadastrar um número que a Ambientar já tem — e a mensagem de erro entregaria
-- que aquele contato existe em outra base.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class     rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns  ON ns.oid  = rel.relnamespace
     WHERE ns.nspname = 'public'
       AND rel.relname = 'clientes'
       AND con.contype = 'u'
       AND con.conkey = ARRAY[
             (SELECT attnum FROM pg_attribute
               WHERE attrelid = rel.oid AND attname = 'telefone')
           ]
  LOOP
    EXECUTE format('ALTER TABLE public.clientes DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS clientes_empresa_telefone_key
  ON public.clientes (empresa_id, telefone);

-- `integracoes_whatsapp_unica_ativa` permitia UMA integração ativa no banco
-- inteiro. Era o pior dos problemas: ao ativar a Evolution da Império, a da
-- Ambientar seria desativada e os disparos dela parariam. Agora é uma ativa
-- POR EMPRESA — cada cliente com sua instância, sem disputa.
DROP INDEX IF EXISTS public.integracoes_whatsapp_unica_ativa;
CREATE UNIQUE INDEX IF NOT EXISTS integracoes_whatsapp_unica_ativa_por_empresa
  ON public.integracoes_whatsapp (empresa_id)
  WHERE ativo = true;

-- ------------------------------------------------------- RLS POR EMPRESA --
-- Substitui todas as policies `USING (true)`.
DO $$
DECLARE
  v_tabela  TEXT;
  v_policy  RECORD;
BEGIN
  FOREACH v_tabela IN ARRAY ARRAY['clientes', 'mensagens', 'historico_envios', 'integracoes_whatsapp']
  LOOP
    -- Remove qualquer policy anterior da tabela: as antigas são todas
    -- permissivas (`USING (true)`), e no Postgres policies permissivas se
    -- somam — deixar uma para trás anularia todo o isolamento.
    FOR v_policy IN
      SELECT policyname FROM pg_policies
       WHERE schemaname = 'public' AND tablename = v_tabela
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_tabela);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tabela);
    EXECUTE format($f$
      CREATE POLICY "Acesso restrito à empresa" ON public.%I
        FOR ALL TO authenticated
        USING      (empresa_id = (SELECT public.empresa_do_usuario()))
        WITH CHECK (empresa_id = (SELECT public.empresa_do_usuario()))
    $f$, v_tabela);
  END LOOP;
END $$;

-- --------------------------------------- STORAGE: fotos de campanha por empresa --
-- Leitura continua pública (Evolution/Meta/Z-API buscam a mídia por URL na
-- hora de enviar), mas gravar e apagar passam a exigir que o arquivo esteja na
-- pasta da própria empresa — antes, qualquer autenticado apagava o anexo de
-- campanha de qualquer cliente.
--
-- Arquivos antigos estão na raiz do bucket (sem pasta): seguem legíveis, mas
-- não são mais apagáveis pelo painel. São anexos de campanhas já enviadas.
DROP POLICY IF EXISTS "Leitura pública campanhas"    ON storage.objects;
DROP POLICY IF EXISTS "Upload autenticado campanhas" ON storage.objects;
DROP POLICY IF EXISTS "Delete autenticado campanhas" ON storage.objects;

CREATE POLICY "Leitura pública campanhas" ON storage.objects
  FOR SELECT USING (bucket_id = 'campanhas');

CREATE POLICY "Upload campanhas da empresa" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'campanhas'
    AND (storage.foldername(name))[1] = (SELECT public.empresa_do_usuario())::text
  );

CREATE POLICY "Delete campanhas da empresa" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'campanhas'
    AND (storage.foldername(name))[1] = (SELECT public.empresa_do_usuario())::text
  );

-- ------------------------------------------------- VÍNCULO DOS USUÁRIOS ATUAIS --
-- Todo login que já existia é da Ambientar. Sem isto eles perdem o acesso na
-- hora em que a RLS entra em vigor.
INSERT INTO public.usuarios_empresas (user_id, empresa_id)
SELECT u.id, (SELECT id FROM public.empresas WHERE slug = 'ambientar')
  FROM auth.users u
ON CONFLICT (user_id) DO NOTHING;

-- --------------------------------------------------- ACESSO DA IMPÉRIO JOIAS --
-- O login do gestor NÃO é criado aqui: a criação exige a senha em texto puro, e
-- este arquivo é versionado — senha commitada fica no histórico do git para
-- sempre, mesmo depois de trocada.
--
-- Rode em seguida `supabase/seed-login-imperio.local.sql`, que fica fora do
-- versionamento pelo padrão `supabase/*.local.sql` do .gitignore — mesma
-- convenção já usada para o token da Evolution.
--
-- A Império começa com base vazia e sem integração: ela cadastra a Evolution
-- dela em Configurações > Integrações, e a unique por empresa garante que isso
-- não encosta na instância da Ambientar.
