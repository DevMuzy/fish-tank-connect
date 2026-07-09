
-- Integrações WhatsApp
CREATE TABLE public.integracoes_whatsapp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  provedor TEXT NOT NULL DEFAULT 'mock',
  url_base TEXT,
  token TEXT,
  numero_remetente TEXT,
  ativo BOOLEAN NOT NULL DEFAULT false,
  status_conexao TEXT NOT NULL DEFAULT 'desconhecido',
  ultimo_check TIMESTAMPTZ,
  observacoes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.integracoes_whatsapp TO authenticated;
GRANT ALL ON public.integracoes_whatsapp TO service_role;

ALTER TABLE public.integracoes_whatsapp ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users manage integracoes" ON public.integracoes_whatsapp
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_integracoes_updated
  BEFORE UPDATE ON public.integracoes_whatsapp
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Garante somente uma integração ativa
CREATE UNIQUE INDEX integracoes_whatsapp_unica_ativa
  ON public.integracoes_whatsapp (ativo)
  WHERE ativo = true;

-- Histórico ampliado
ALTER TABLE public.historico_envios
  ADD COLUMN IF NOT EXISTS tentativas INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultimo_erro TEXT,
  ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.set_historico_atualizado_em()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_historico_atualizado ON public.historico_envios;
CREATE TRIGGER trg_historico_atualizado
  BEFORE UPDATE ON public.historico_envios
  FOR EACH ROW EXECUTE FUNCTION public.set_historico_atualizado_em();

CREATE INDEX IF NOT EXISTS historico_envios_mensagem_idx ON public.historico_envios(mensagem_id);
CREATE INDEX IF NOT EXISTS historico_envios_status_idx ON public.historico_envios(status);

-- Mensagens: contagem de erros
ALTER TABLE public.mensagens
  ADD COLUMN IF NOT EXISTS erros INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sucesso INTEGER NOT NULL DEFAULT 0;

-- Seed integração mock com número solicitado
INSERT INTO public.integracoes_whatsapp (nome, provedor, numero_remetente, ativo, status_conexao, observacoes)
VALUES ('Mock (simulador)', 'mock', '27999255959', true, 'simulado', 'Provedor simulado. Substitua por Evolution/Z-API/Meta Cloud para envios reais.')
ON CONFLICT DO NOTHING;
