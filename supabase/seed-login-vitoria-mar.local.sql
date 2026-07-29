-- ============================================================================
-- Login da Peixaria Vitória Mar — FORA DO VERSIONAMENTO
--
-- Casa com `supabase/*.local.sql` no .gitignore: tem senha em texto puro e por
-- isso não entra no repositório. Senha commitada fica no histórico do git para
-- sempre, mesmo depois de trocada.
--
-- POR QUE ESTE ARQUIVO EXISTE: o painel da Vitória Mar passou a apontar para o
-- banco compartilhado, mas o login dela vivia no projeto Supabase antigo
-- (xdfcevpiwfpnbopcdtit). No banco novo ele nunca foi criado — daí o
-- "Invalid login credentials".
--
-- Rode DEPOIS do setup-banco-compartilhado.sql (que cria `empresas`,
-- `usuarios_empresas` e a extensão pgcrypto).
--
-- Idempotente: rodar de novo só redefine a senha.
-- ============================================================================

DO $$
DECLARE
  v_email TEXT := 'aline@peixaria.com';
  v_senha TEXT := '123456789';
  v_nome  TEXT := 'Aline';
  v_slug  TEXT := 'vitoria-mar';
  v_id    UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.empresas WHERE slug = v_slug) THEN
    RAISE EXCEPTION 'Empresa % não existe. Rode setup-banco-compartilhado.sql primeiro.', v_slug;
  END IF;

  SELECT id INTO v_id FROM auth.users WHERE email = v_email;

  IF v_id IS NOT NULL THEN
    UPDATE auth.users
       SET encrypted_password = extensions.crypt(v_senha, extensions.gen_salt('bf')),
           email_confirmed_at = COALESCE(email_confirmed_at, now()),
           updated_at         = now()
     WHERE id = v_id;
    RAISE NOTICE 'Usuário % já existia — senha redefinida.', v_email;
  ELSE
    v_id := gen_random_uuid();

    -- email_confirmed_at na criação: sem isso o login só passa depois que a
    -- pessoa clicar num e-mail de confirmação que talvez nunca chegue.
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      v_email, extensions.crypt(v_senha, extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nome', v_nome),
      '', '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_id, v_id::text,
      jsonb_build_object('sub', v_id::text, 'email', v_email,
                         'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    );
    RAISE NOTICE 'Usuário % criado.', v_email;
  END IF;

  -- DO UPDATE e não DO NOTHING: o setup manda todo usuário sem vínculo para a
  -- Ambientar, então se este login já existia por lá o vínculo precisa ser
  -- corrigido para a Vitória Mar aqui.
  INSERT INTO public.usuarios_empresas (user_id, empresa_id)
  VALUES (v_id, (SELECT id FROM public.empresas WHERE slug = v_slug))
  ON CONFLICT (user_id) DO UPDATE SET empresa_id = EXCLUDED.empresa_id;
END $$;

-- Confere quem ficou em qual empresa.
SELECT e.slug, e.nome AS empresa, u.email,
       u.email_confirmed_at IS NOT NULL AS confirmado
  FROM auth.users u
  JOIN public.usuarios_empresas ue ON ue.user_id = u.id
  JOIN public.empresas e           ON e.id = ue.empresa_id
 ORDER BY e.nome, u.email;
