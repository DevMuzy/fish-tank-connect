-- ============================================================================
-- ENTRADA DE CLIENTE NOVO — script único
--
-- Troque os 5 valores do bloco CONFIGURE ABAIXO e rode inteiro no SQL Editor.
--
-- IMPORTANTE: edite os valores DENTRO do SQL Editor, não neste arquivo. A senha
-- em texto puro não pode ser salva no repositório — commitada, ela fica no
-- histórico do git para sempre, mesmo depois de trocada.
--
-- O script se recusa a concluir se o isolamento entre empresas não estiver
-- íntegro. Isso é deliberado: já aconteceu de as policies parecerem certas, o
-- SQL rodar sem erro, e os painéis continuarem vendo a mesma base de clientes.
-- Antes de criar mais um cliente, o banco tem que provar que separa os que já
-- existem.
--
-- Pré-requisito: `auditoria-isolamento.sql` instalado (cria a função de
-- verificação usada aqui).
-- ============================================================================

DO $$
DECLARE
  -- ======================== CONFIGURE ========================
  v_slug   TEXT := 'nome-curto-do-cliente';   -- só minúsculas e hífen. TEM que
                                              -- ser idêntico ao VITE_EMPRESA_SLUG
                                              -- e EMPRESA_SLUG da Vercel.
  v_nome   TEXT := 'Nome Comercial do Cliente';
  v_email  TEXT := 'acesso@cliente.com';
  v_senha  TEXT := 'trocar-esta-senha';
  v_gestor TEXT := 'Nome da Pessoa';
  -- ===========================================================

  v_empresa_id UUID;
  v_user_id    UUID;
  v_problemas  INT;
  v_lista      TEXT;
BEGIN
  -- ------------------------------------------------- 0. Validações de entrada --
  IF v_slug = 'nome-curto-do-cliente' OR v_email = 'acesso@cliente.com' THEN
    RAISE EXCEPTION 'Preencha o bloco CONFIGURE antes de rodar.';
  END IF;

  IF v_slug !~ '^[a-z][a-z0-9-]{1,40}$' THEN
    RAISE EXCEPTION 'Slug inválido: "%". Use só minúsculas, números e hífen — '
                    'ele precisa casar exatamente com a env var da Vercel.', v_slug;
  END IF;

  -- ------------------------------------ 1. O banco já isola quem está dentro? --
  -- Roda ANTES de criar o cliente novo. Se o isolamento estiver quebrado, mais
  -- um cliente significa mais uma base exposta.
  SELECT count(*), string_agg(problema || ' [' || onde || ']', E'\n  ')
    INTO v_problemas, v_lista
    FROM public.auditar_isolamento()
   WHERE gravidade = 'CRITICO';

  IF v_problemas > 0 THEN
    RAISE EXCEPTION E'ISOLAMENTO QUEBRADO — nada foi criado.\n\n  %\n\n'
                    'Rode supabase/corrigir-isolamento.sql e tente de novo.', v_lista;
  END IF;

  -- ------------------------------------------------------------- 2. A empresa --
  INSERT INTO public.empresas (slug, nome)
  VALUES (v_slug, v_nome)
  ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome
  RETURNING id INTO v_empresa_id;

  RAISE NOTICE 'Empresa %: % (%)', v_slug, v_nome, v_empresa_id;

  -- --------------------------------------------------------------- 3. O login --
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;

  IF v_user_id IS NOT NULL THEN
    UPDATE auth.users
       SET encrypted_password = extensions.crypt(v_senha, extensions.gen_salt('bf')),
           email_confirmed_at = COALESCE(email_confirmed_at, now()),
           updated_at         = now()
     WHERE id = v_user_id;
    RAISE NOTICE 'Login % já existia — senha redefinida.', v_email;
  ELSE
    v_user_id := gen_random_uuid();

    -- email_confirmed_at preenchido na criação: sem isso o acesso só funciona
    -- depois de clicar num e-mail de confirmação que costuma nunca chegar.
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_user_id,
      'authenticated', 'authenticated',
      v_email, extensions.crypt(v_senha, extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nome', v_gestor),
      '', '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_user_id, v_user_id::text,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email,
                         'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    );
    RAISE NOTICE 'Login % criado.', v_email;
  END IF;

  -- ---------------------------------------------------------- 4. O vínculo --
  -- DO UPDATE e não DO NOTHING: se este login já existia vinculado a outra
  -- empresa, o vínculo tem que ser corrigido, não ignorado.
  INSERT INTO public.usuarios_empresas (user_id, empresa_id)
  VALUES (v_user_id, v_empresa_id)
  ON CONFLICT (user_id) DO UPDATE SET empresa_id = EXCLUDED.empresa_id;

  RAISE NOTICE 'Vínculo: % → %', v_email, v_slug;

  -- ----------------------------------- 5. Continua íntegro depois de criar? --
  SELECT count(*) INTO v_problemas
    FROM public.auditar_isolamento() WHERE gravidade = 'CRITICO';

  IF v_problemas > 0 THEN
    RAISE EXCEPTION 'A criação quebrou o isolamento — desfazendo tudo.';
  END IF;

  RAISE NOTICE '--- OK. Agora cadastre na Vercel: VITE_EMPRESA_SLUG=% e EMPRESA_SLUG=% ---',
    v_slug, v_slug;
END $$;

-- ============================================================================
-- CONFERÊNCIA 1 — auditoria. Nenhuma linha CRITICO.
-- ============================================================================
SELECT * FROM public.auditar_isolamento();

-- ============================================================================
-- CONFERÊNCIA 2 — quem vê o quê.
-- Cada empresa tem que aparecer só com os próprios números.
-- ============================================================================
SELECT e.slug,
       e.nome,
       e.delay_envio_ms AS delay_ms,
       (SELECT count(*) FROM public.clientes             c WHERE c.empresa_id = e.id) AS clientes,
       (SELECT count(*) FROM public.mensagens            m WHERE m.empresa_id = e.id) AS campanhas,
       (SELECT count(*) FROM public.integracoes_whatsapp i WHERE i.empresa_id = e.id AND i.ativo) AS integr_ativas,
       (SELECT string_agg(u.email, ', ')
          FROM public.usuarios_empresas ue
          JOIN auth.users u ON u.id = ue.user_id
         WHERE ue.empresa_id = e.id) AS logins
  FROM public.empresas e
 ORDER BY e.nome;
