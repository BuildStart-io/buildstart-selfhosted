BEGIN;

ALTER TABLE auth.users DISABLE TRIGGER ALL;

DO $$
DECLARE
  new_user_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, recovery_sent_at, last_sign_in_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', 'superadmin@buildstart.io',
    crypt('z*FYmCChc%4R^3', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(),
    '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), new_user_id, new_user_id, format('{"sub":"%s","email":"superadmin@buildstart.io"}', new_user_id)::jsonb, 'email', now(), now(), now()
  );

  INSERT INTO happypetal_customization.profiles (user_id, email, full_name)
  VALUES (new_user_id, 'superadmin@buildstart.io', 'Super Admin');

  INSERT INTO happypetal_customization.user_roles (user_id, role)
  VALUES (new_user_id, 'superadmin');

  INSERT INTO happypetal_customization.settings (user_id, key, value) VALUES
    (new_user_id, 'welcome_message', '{"text": "Welcome!"}'::jsonb),
    (new_user_id, 'payment_info', '{"bank_name": ""}'::jsonb),
    (new_user_id, 'auto_responses', '{"enabled": true}'::jsonb);
END;
$$;

ALTER TABLE auth.users ENABLE TRIGGER ALL;

COMMIT;
