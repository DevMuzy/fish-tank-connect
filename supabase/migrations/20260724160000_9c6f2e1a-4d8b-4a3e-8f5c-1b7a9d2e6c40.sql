-- Foto opcional anexada ao disparo de campanha
ALTER TABLE public.mensagens
  ADD COLUMN IF NOT EXISTS imagem_url TEXT;

-- Bucket público para as fotos de campanha (a Evolution/Meta/Z-API precisam
-- buscar a imagem por URL pública ao enviar a mídia)
INSERT INTO storage.buckets (id, name, public)
VALUES ('campanhas', 'campanhas', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Leitura pública campanhas" ON storage.objects
  FOR SELECT USING (bucket_id = 'campanhas');

CREATE POLICY "Upload autenticado campanhas" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'campanhas');

CREATE POLICY "Delete autenticado campanhas" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'campanhas');
