
-- CLIENTES
CREATE TABLE public.clientes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL UNIQUE,
  data_nascimento DATE NOT NULL,
  cpf TEXT,
  endereco TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clientes TO authenticated;
GRANT ALL ON public.clientes TO service_role;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can view clientes" ON public.clientes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can insert clientes" ON public.clientes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth users can update clientes" ON public.clientes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth users can delete clientes" ON public.clientes FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_clientes_nome ON public.clientes (nome);
CREATE INDEX idx_clientes_telefone ON public.clientes (telefone);
CREATE INDEX idx_clientes_nascimento ON public.clientes (data_nascimento);
CREATE INDEX idx_clientes_created_at ON public.clientes (created_at DESC);

-- shared updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_clientes_updated_at BEFORE UPDATE ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- MENSAGENS (campanhas / envios agregados)
CREATE TABLE public.mensagens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mensagem TEXT NOT NULL,
  tipo_envio TEXT NOT NULL, -- 'todos' | 'individual' | 'aniversariantes'
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  quantidade_destinatarios INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'concluido', -- 'concluido' | 'parcial' | 'falhou'
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mensagens TO authenticated;
GRANT ALL ON public.mensagens TO service_role;
ALTER TABLE public.mensagens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users manage mensagens" ON public.mensagens FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_mensagens_created_at ON public.mensagens (created_at DESC);

-- HISTORICO DE ENVIOS (linha por destinatário)
CREATE TABLE public.historico_envios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mensagem_id UUID REFERENCES public.mensagens(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  telefone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enviado', -- 'enviado' | 'falhou' | 'simulado'
  resposta_api JSONB,
  data_envio TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.historico_envios TO authenticated;
GRANT ALL ON public.historico_envios TO service_role;
ALTER TABLE public.historico_envios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users manage historico" ON public.historico_envios FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_historico_data_envio ON public.historico_envios (data_envio DESC);
CREATE INDEX idx_historico_mensagem ON public.historico_envios (mensagem_id);
