-- ============================================================================
-- AUDITORIA DE ISOLAMENTO — instala a função `public.auditar_isolamento()`
--
-- Existe porque já aconteceu: as policies corretas foram criadas, o SQL rodou
-- sem erro, e os três painéis continuaram vendo a mesma base de clientes. Uma
-- policy antiga `USING (true)` sobreviveu, e no Postgres policies permissivas
-- se SOMAM — uma só liberando tudo anula todas as outras.
--
-- "Rodou sem erro" não prova isolamento. Esta função prova.
--
-- Rode UMA VEZ para instalar. Depois, a qualquer momento:
--     SELECT * FROM public.auditar_isolamento();
--
-- Nenhuma linha = isolamento íntegro.
-- Qualquer linha CRITICO = tem cliente vendo dado de outro. Pare tudo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auditar_isolamento()
RETURNS TABLE (gravidade TEXT, problema TEXT, onde TEXT, o_que_fazer TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Toda tabela que carrega `empresa_id` é, por definição, tabela multi-cliente
  -- e precisa de RLS. Descobrir isso pela coluna (em vez de por uma lista fixa)
  -- é o que faz a auditoria cobrir tabelas criadas depois desta função.
  CREATE TEMP TABLE IF NOT EXISTS _tabelas_multi ON COMMIT DROP AS
  SELECT c.oid, c.relname::text AS tabela, c.relrowsecurity AS rls_ligada
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND a.attname = 'empresa_id'
     AND a.attnum > 0
     AND NOT a.attisdropped;

  -- ---------------------------------------------------------------- CRÍTICOS --

  -- 1. Tabela multi-cliente com RLS desligada: leitura livre para qualquer login.
  RETURN QUERY
  SELECT 'CRITICO', 'RLS desligada em tabela com empresa_id', t.tabela,
         format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t.tabela)
    FROM _tabelas_multi t
   WHERE NOT t.rls_ligada;

  -- 2. Policy permissiva sem filtro — o furo que já nos pegou.
  --    `qual IS NULL` cobre policies FOR INSERT, que só têm WITH CHECK.
  RETURN QUERY
  SELECT 'CRITICO', 'Policy libera tudo (USING true)',
         p.tablename || ' → ' || p.policyname,
         format('DROP POLICY %I ON public.%I;', p.policyname, p.tablename)
    FROM pg_policies p
    JOIN _tabelas_multi t ON t.tabela = p.tablename
   WHERE p.schemaname = 'public'
     AND p.permissive = 'PERMISSIVE'
     AND (p.qual IS NULL OR btrim(replace(p.qual, ' ', '')) IN ('true', '(true)'));

  -- 3. Policy que não filtra por empresa. Qualquer condição que não mencione
  --    `empresa_do_usuario` está deixando passar linha de outro cliente.
  RETURN QUERY
  SELECT 'CRITICO', 'Policy não filtra por empresa',
         p.tablename || ' → ' || p.policyname,
         'Revise a condição: deve conter empresa_id = empresa_do_usuario()'
    FROM pg_policies p
    JOIN _tabelas_multi t ON t.tabela = p.tablename
   WHERE p.schemaname = 'public'
     AND p.permissive = 'PERMISSIVE'
     AND p.qual IS NOT NULL
     AND btrim(replace(p.qual, ' ', '')) NOT IN ('true', '(true)')
     AND p.qual NOT LIKE '%empresa_do_usuario%';

  -- 4. Tabela multi-cliente sem policy nenhuma. Com RLS ligada e zero policies o
  --    acesso fica fechado (falha segura), mas o painel para de funcionar.
  RETURN QUERY
  SELECT 'CRITICO', 'Tabela com empresa_id sem nenhuma policy', t.tabela,
         'Crie a policy de empresa — o painel não consegue ler nem gravar'
    FROM _tabelas_multi t
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = t.tabela
   );

  -- 5. INSERT sem WITH CHECK por empresa: deixaria gravar linha carimbada com a
  --    empresa de outro cliente.
  RETURN QUERY
  SELECT 'CRITICO', 'Policy de escrita sem WITH CHECK por empresa',
         p.tablename || ' → ' || p.policyname,
         'Adicione WITH CHECK (empresa_id = empresa_do_usuario())'
    FROM pg_policies p
    JOIN _tabelas_multi t ON t.tabela = p.tablename
   WHERE p.schemaname = 'public'
     AND p.cmd IN ('ALL', 'INSERT', 'UPDATE')
     AND (p.with_check IS NULL OR p.with_check NOT LIKE '%empresa_do_usuario%');

  -- 6. Coluna empresa_id sem NOT NULL: linha órfã não casa com policy nenhuma e
  --    fica invisível para todos, inclusive para quem a criou.
  RETURN QUERY
  SELECT 'CRITICO', 'empresa_id aceita NULL', t.tabela,
         format('ALTER TABLE public.%I ALTER COLUMN empresa_id SET NOT NULL;', t.tabela)
    FROM _tabelas_multi t
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = 'empresa_id'
   WHERE NOT a.attnotnull;

  -- ------------------------------------------------------------------ AVISOS --

  -- 7. Login sem empresa: não vê nada em lugar nenhum (falha segura), mas para
  --    a pessoa o painel parece quebrado.
  RETURN QUERY
  SELECT 'AVISO', 'Login sem empresa vinculada', u.email::text,
         'INSERT INTO usuarios_empresas (user_id, empresa_id) VALUES (...);'
    FROM auth.users u
   WHERE NOT EXISTS (
     SELECT 1 FROM public.usuarios_empresas ue WHERE ue.user_id = u.id
   );

  -- 8. Dois logins da mesma empresa é normal (dono + funcionário). Empresa
  --    nenhum login é cliente que não consegue entrar.
  RETURN QUERY
  SELECT 'AVISO', 'Empresa sem nenhum login', e.slug,
         'Crie o acesso do cliente antes de entregar o painel'
    FROM public.empresas e
   WHERE NOT EXISTS (
     SELECT 1 FROM public.usuarios_empresas ue WHERE ue.empresa_id = e.id
   );

  -- 9. Mais de uma integração ativa na mesma empresa: o disparo carrega uma só,
  --    e qual delas fica indefinido.
  RETURN QUERY
  SELECT 'AVISO', 'Empresa com mais de uma integração ativa', e.slug,
         'Deixe apenas uma ativa em Configurações > Integrações'
    FROM public.empresas e
    JOIN public.integracoes_whatsapp i ON i.empresa_id = e.id AND i.ativo
   GROUP BY e.slug
  HAVING count(*) > 1;

  -- 10. Delay abaixo do piso combinado de 15s.
  RETURN QUERY
  SELECT 'AVISO', 'Delay de envio abaixo de 15s',
         e.slug || ' = ' || e.delay_envio_ms || 'ms',
         'UPDATE empresas SET delay_envio_ms = 15000 WHERE slug = ''' || e.slug || ''';'
    FROM public.empresas e
   WHERE e.delay_envio_ms < 15000;

  -- 11. Storage: anexo fora da pasta da empresa não é apagável pelo painel.
  RETURN QUERY
  SELECT 'AVISO', 'Anexo de campanha fora da pasta da empresa',
         count(*) || ' arquivo(s) na raiz do bucket',
         'Arquivos antigos: seguem visíveis, mas o painel não consegue apagar'
    FROM storage.objects o
   WHERE o.bucket_id = 'campanhas'
     AND (storage.foldername(o.name))[1] IS NULL
  HAVING count(*) > 0;

END $$;

REVOKE ALL ON FUNCTION public.auditar_isolamento() FROM PUBLIC;
-- Só o SQL Editor roda: não é informação para o painel do cliente.
GRANT EXECUTE ON FUNCTION public.auditar_isolamento() TO service_role;

-- ============================================================================
-- Roda agora. Nenhuma linha = isolamento íntegro.
-- ============================================================================
SELECT * FROM public.auditar_isolamento();
