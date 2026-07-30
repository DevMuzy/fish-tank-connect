-- ============================================================================
-- FECHA A LISTAGEM DE FOTOS DE CAMPANHA ENTRE EMPRESAS
--
-- O bucket `campanhas` é público porque Evolution/Meta/Z-API buscam a mídia por
-- URL, sem login, na hora de enviar. Isso não muda.
--
-- O que muda: hoje um usuário logado consegue LISTAR o bucket inteiro e
-- descobrir os arquivos das outras empresas. A leitura por URL pública continua
-- liberada (é o que a Evolution usa); a listagem passa a ser só da própria pasta.
--
-- Não quebra nada no painel: ele só faz `upload` e `getPublicUrl`. Não existe
-- `.list()`, `.download()` nem `.remove()` em nenhum dos três repositórios —
-- conferido antes de escrever isto.
-- ============================================================================

DROP POLICY IF EXISTS "Leitura pública campanhas"     ON storage.objects;
DROP POLICY IF EXISTS "Upload autenticado campanhas"  ON storage.objects;
DROP POLICY IF EXISTS "Delete autenticado campanhas"  ON storage.objects;
DROP POLICY IF EXISTS "Upload campanhas da empresa"   ON storage.objects;
DROP POLICY IF EXISTS "Delete campanhas da empresa"   ON storage.objects;
DROP POLICY IF EXISTS "Leitura anonima campanhas"     ON storage.objects;
DROP POLICY IF EXISTS "Listagem campanhas da empresa" ON storage.objects;

-- Leitura sem login: é por aqui que a Evolution baixa a imagem para enviar.
-- Some o acesso, some a foto da campanha.
CREATE POLICY "Leitura anonima campanhas" ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'campanhas');

-- Usuário logado só enxerga a própria pasta. É esta policy que impede um
-- cliente de listar e abrir os anexos de campanha de outro.
CREATE POLICY "Listagem campanhas da empresa" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'campanhas'
    AND (storage.foldername(name))[1] = (SELECT public.empresa_do_usuario())::text
  );

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

-- Conferência: 4 policies, e nenhuma liberando o bucket inteiro para logado.
SELECT policyname, roles::text, cmd, qual::text AS usando
  FROM pg_policies
 WHERE schemaname = 'storage' AND tablename = 'objects'
   AND policyname ILIKE '%campanhas%'
 ORDER BY policyname;
