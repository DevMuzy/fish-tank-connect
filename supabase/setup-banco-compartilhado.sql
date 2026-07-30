-- ============================================================================
-- BANCO ÚNICO, VÁRIOS CLIENTES — script completo para o SQL Editor
--
-- Um projeto Supabase atende todos os painéis. Cada cliente tem seu repositório
-- no GitHub e seu domínio na Vercel, mas o banco é este. A separação é feita
-- por `empresa_id` + RLS: o Postgres não devolve uma linha sequer de outra
-- empresa, mesmo que o front tenha bug.
--
-- Cole INTEIRO no SQL Editor e rode. É idempotente — pode rodar de novo sem
-- quebrar nada, e funciona tanto num projeto vazio quanto no que já tem a
-- Ambientar rodando.
--
-- NÃO cria logins: isso exige senha em texto puro e sai em arquivo separado,
-- fora do versionamento (ver o passo 9 no fim).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ============================================================ 1. FUNÇÕES ==
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.set_historico_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END; $$;

-- =========================================================== 2. EMPRESAS ==
CREATE TABLE IF NOT EXISTS public.empresas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT NOT NULL UNIQUE,     -- casa com VITE_EMPRESA_SLUG do deploy
  nome       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Delay entre um envio e o próximo, em milissegundos. Mora aqui, e não numa
-- constante de código, porque cada cliente tem seu repositório: como constante
-- ela divergiria na primeira vez que alguém editasse um repo e esquecesse os
-- outros. O CHECK garante o piso de 15s para todo cliente, atual ou futuro.
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS delay_envio_ms INTEGER NOT NULL DEFAULT 15000;
ALTER TABLE public.empresas DROP CONSTRAINT IF EXISTS empresas_delay_minimo;
ALTER TABLE public.empresas
  ADD CONSTRAINT empresas_delay_minimo CHECK (delay_envio_ms >= 15000);
UPDATE public.empresas SET delay_envio_ms = 15000 WHERE delay_envio_ms < 15000;

-- Um login pertence a exatamente uma empresa (PK em user_id). Quem precisar de
-- dois painéis ganha dois logins — mais fácil de auditar do que um seletor de
-- empresa na tela, e elimina o risco de disparar para a base errada.
CREATE TABLE IF NOT EXISTS public.usuarios_empresas (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usuarios_empresas_empresa
  ON public.usuarios_empresas (empresa_id);

-- Empresa do usuário logado.
-- SECURITY DEFINER é obrigatório: esta função é chamada de dentro das policies
-- das outras tabelas. Se lesse `usuarios_empresas` com os privilégios do
-- chamador, a RLS daquela tabela dispararia durante a avaliação da RLS desta e
-- o Postgres entraria em recursão infinita.
-- Retorna NULL para usuário sem vínculo, e `empresa_id = NULL` é NULL (não
-- TRUE): usuário novo nasce sem ver nada. Falha fechada.
CREATE OR REPLACE FUNCTION public.empresa_do_usuario()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT empresa_id FROM public.usuarios_empresas WHERE user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.empresa_do_usuario() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresa_do_usuario() TO authenticated;

GRANT SELECT ON public.empresas          TO authenticated;
GRANT SELECT ON public.usuarios_empresas TO authenticated;
GRANT ALL    ON public.empresas          TO service_role;
GRANT ALL    ON public.usuarios_empresas TO service_role;

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

-- Sem policy de INSERT/UPDATE/DELETE: quem pertence a qual empresa só muda
-- daqui, pelo SQL Editor. Nenhum painel consegue se remanejar sozinho.

-- ================================================ 3. TABELAS DO NEGÓCIO ==
CREATE TABLE IF NOT EXISTS public.clientes (
  id              UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome            TEXT NOT NULL,
  telefone        TEXT NOT NULL,
  data_nascimento DATE NOT NULL,
  cpf             TEXT,
  endereco        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.mensagens (
  id                       UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mensagem                 TEXT NOT NULL,
  tipo_envio               TEXT NOT NULL,   -- 'todos'|'individual'|'aniversariantes'
  cliente_id               UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  quantidade_destinatarios INT NOT NULL DEFAULT 0,
  status                   TEXT NOT NULL DEFAULT 'concluido',
  created_by               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.mensagens
  ADD COLUMN IF NOT EXISTS erros      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sucesso    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS imagem_url TEXT;

CREATE TABLE IF NOT EXISTS public.historico_envios (
  id          UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mensagem_id UUID REFERENCES public.mensagens(id) ON DELETE CASCADE,
  cliente_id  UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  telefone    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'enviado',
  resposta_api JSONB,
  data_envio  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.historico_envios
  ADD COLUMN IF NOT EXISTS tentativas    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultimo_erro   TEXT,
  ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.integracoes_whatsapp (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome             TEXT NOT NULL,
  provedor         TEXT NOT NULL DEFAULT 'mock',   -- mock|evolution|zapi|meta
  url_base         TEXT,
  token            TEXT,
  numero_remetente TEXT,
  ativo            BOOLEAN NOT NULL DEFAULT false,
  status_conexao   TEXT NOT NULL DEFAULT 'desconhecido',
  ultimo_check     TIMESTAMPTZ,
  observacoes      TEXT,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_clientes_updated_at ON public.clientes;
CREATE TRIGGER trg_clientes_updated_at BEFORE UPDATE ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_integracoes_updated ON public.integracoes_whatsapp;
CREATE TRIGGER trg_integracoes_updated BEFORE UPDATE ON public.integracoes_whatsapp
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_historico_atualizado ON public.historico_envios;
CREATE TRIGGER trg_historico_atualizado BEFORE UPDATE ON public.historico_envios
  FOR EACH ROW EXECUTE FUNCTION public.set_historico_atualizado_em();

CREATE INDEX IF NOT EXISTS idx_clientes_nome        ON public.clientes (nome);
CREATE INDEX IF NOT EXISTS idx_clientes_telefone    ON public.clientes (telefone);
CREATE INDEX IF NOT EXISTS idx_clientes_nascimento  ON public.clientes (data_nascimento);
CREATE INDEX IF NOT EXISTS idx_clientes_created_at  ON public.clientes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mensagens_created_at ON public.mensagens (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_historico_data_envio ON public.historico_envios (data_envio DESC);
CREATE INDEX IF NOT EXISTS historico_envios_mensagem_idx ON public.historico_envios (mensagem_id);
CREATE INDEX IF NOT EXISTS historico_envios_status_idx   ON public.historico_envios (status);

-- ==================================== 4. COLUNA empresa_id + BACKFILL ==
-- Tudo que já existe no banco é da Ambientar (ela era a única antes disto).
DO $$
DECLARE
  v_ambientar UUID;
  v_tabela    TEXT;
BEGIN
  INSERT INTO public.empresas (slug, nome) VALUES ('ambientar', 'Ambientar Móveis')
  ON CONFLICT (slug) DO NOTHING;
  SELECT id INTO v_ambientar FROM public.empresas WHERE slug = 'ambientar';

  FOREACH v_tabela IN ARRAY ARRAY['clientes','mensagens','historico_envios','integracoes_whatsapp']
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES public.empresas(id) ON DELETE RESTRICT',
      v_tabela);
    EXECUTE format('UPDATE public.%I SET empresa_id = $1 WHERE empresa_id IS NULL', v_tabela)
      USING v_ambientar;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN empresa_id SET NOT NULL', v_tabela);

    -- DEFAULT resolvido no banco: os INSERTs do app não passam empresa_id, e
    -- assim não existe caminho de código capaz de esquecer de preencher.
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN empresa_id SET DEFAULT public.empresa_do_usuario()',
      v_tabela);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_empresa ON public.%I (empresa_id)',
      v_tabela, v_tabela);
  END LOOP;
END $$;

-- ========================================= 5. UNIQUES QUE ERAM GLOBAIS ==
-- `clientes.telefone` era UNIQUE no banco inteiro: um cliente não conseguiria
-- cadastrar um número que outro já tem — e o erro entregaria que aquele
-- contato existe na base alheia.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class     rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns  ON ns.oid  = rel.relnamespace
     WHERE ns.nspname = 'public' AND rel.relname = 'clientes' AND con.contype = 'u'
       AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                WHERE attrelid = rel.oid AND attname = 'telefone')]
  LOOP
    EXECUTE format('ALTER TABLE public.clientes DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS clientes_empresa_telefone_key
  ON public.clientes (empresa_id, telefone);

-- Este é o índice que impede a confusão de Evolution entre clientes. Antes ele
-- era UNIQUE (ativo) WHERE ativo — UMA integração ativa no banco inteiro. Ao
-- ativar a instância de um cliente, a do outro era desligada e os disparos dele
-- paravam. Agora é uma ativa POR EMPRESA.
DROP INDEX IF EXISTS public.integracoes_whatsapp_unica_ativa;
CREATE UNIQUE INDEX IF NOT EXISTS integracoes_whatsapp_unica_ativa_por_empresa
  ON public.integracoes_whatsapp (empresa_id) WHERE ativo = true;

-- ================================================== 6. RLS POR EMPRESA ==
-- Derruba TODA policy anterior antes de criar a nova: policies permissivas se
-- somam no Postgres, então uma antiga com `USING (true)` esquecida para trás
-- anularia o isolamento inteiro.
DO $$
DECLARE
  v_tabela TEXT;
  v_policy RECORD;
BEGIN
  FOREACH v_tabela IN ARRAY ARRAY['clientes','mensagens','historico_envios','integracoes_whatsapp']
  LOOP
    FOR v_policy IN
      SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=v_tabela
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_tabela);
    END LOOP;

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', v_tabela);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', v_tabela);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tabela);
    EXECUTE format($f$
      CREATE POLICY "Acesso restrito à empresa" ON public.%I
        FOR ALL TO authenticated
        USING      (empresa_id = (SELECT public.empresa_do_usuario()))
        WITH CHECK (empresa_id = (SELECT public.empresa_do_usuario()))
    $f$, v_tabela);
  END LOOP;
END $$;

-- ============================== 7. STORAGE: fotos de campanha por empresa ==
-- Leitura pública porque Evolution/Meta/Z-API buscam a mídia por URL na hora de
-- enviar. Gravar e apagar exigem a pasta da própria empresa.
INSERT INTO storage.buckets (id, name, public) VALUES ('campanhas','campanhas',true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Leitura pública campanhas"    ON storage.objects;
DROP POLICY IF EXISTS "Upload autenticado campanhas" ON storage.objects;
DROP POLICY IF EXISTS "Delete autenticado campanhas" ON storage.objects;
DROP POLICY IF EXISTS "Upload campanhas da empresa"  ON storage.objects;
DROP POLICY IF EXISTS "Delete campanhas da empresa"  ON storage.objects;

CREATE POLICY "Leitura pública campanhas" ON storage.objects
  FOR SELECT USING (bucket_id = 'campanhas');
CREATE POLICY "Upload campanhas da empresa" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'campanhas'
    AND (storage.foldername(name))[1] = (SELECT public.empresa_do_usuario())::text);
CREATE POLICY "Delete campanhas da empresa" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'campanhas'
    AND (storage.foldername(name))[1] = (SELECT public.empresa_do_usuario())::text);

-- ================================================== 8. OS CLIENTES ==
-- Para adicionar o próximo cliente, acrescente uma linha aqui e rode de novo.
-- O slug tem que ser idêntico ao VITE_EMPRESA_SLUG do deploy dele na Vercel —
-- é por ele que o painel recusa login de outra empresa.
INSERT INTO public.empresas (slug, nome) VALUES
  ('ambientar',     'Ambientar Móveis'),
  ('imperio-joias', 'Império Bolsas & Acessórios'),
  ('vitoria-mar',   'Peixaria Vitória Mar')
ON CONFLICT (slug) DO NOTHING;

-- Todo login que já existia é da Ambientar — ela era a única antes disto. Sem
-- isto os acessos dela param de funcionar na hora em que a RLS entra em vigor.
--
-- ATENÇÃO: isto pega QUALQUER usuário ainda sem vínculo. Se você já criou o
-- login de outro cliente pelo painel do Supabase, vincule-o primeiro (passo 9)
-- ou ele vai parar na Ambientar. O SELECT no fim mostra como ficou.
INSERT INTO public.usuarios_empresas (user_id, empresa_id)
SELECT u.id, (SELECT id FROM public.empresas WHERE slug = 'ambientar')
  FROM auth.users u
ON CONFLICT (user_id) DO NOTHING;

-- ============================================== 9. CONFERÊNCIA FINAL ==
-- Quem está em qual empresa. Confira antes de liberar os painéis.
SELECT e.slug, e.nome, e.delay_envio_ms, u.email
  FROM public.empresas e
  LEFT JOIN public.usuarios_empresas ue ON ue.empresa_id = e.id
  LEFT JOIN auth.users u                ON u.id = ue.user_id
 ORDER BY e.nome, u.email;

-- ----------------------------------------------------------------------------
-- PRÓXIMO PASSO — criar os logins
--
-- Não são criados aqui: exigem senha em texto puro, e este arquivo é
-- versionado. Use `supabase/seed-login-imperio.local.sql` como modelo (ele
-- casa com `supabase/*.local.sql` do .gitignore) trocando e-mail, senha e
-- slug da empresa.
--
-- Para corrigir um vínculo errado a qualquer momento:
--   INSERT INTO public.usuarios_empresas (user_id, empresa_id)
--   VALUES (
--     (SELECT id FROM auth.users WHERE email = 'fulano@cliente.com'),
--     (SELECT id FROM public.empresas WHERE slug = 'slug-do-cliente')
--   ) ON CONFLICT (user_id) DO UPDATE SET empresa_id = EXCLUDED.empresa_id;
-- ----------------------------------------------------------------------------
