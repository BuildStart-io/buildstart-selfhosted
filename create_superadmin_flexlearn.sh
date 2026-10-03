#!/bin/bash
docker exec -i supabase-db psql -U postgres -d postgres << 'SQL'
DO $$
DECLARE
  new_user_id uuid := gen_random_uuid();
  enc_pw text := crypt('VxT2DscDY!lYD2', gen_salt('bf'));
  new_owner_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, 
    recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, 
    created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', 
    'superadmin-flexlearn@buildstart.io', enc_pw, now(), now(), now(), 
    '{"provider":"email","providers":["email"]}', '{"full_name":"FlexLearn Superadmin"}', 
    now(), now(), '', '', '', ''
  );

  INSERT INTO flexlearn_customization.staff_accounts (
    owner_id, staff_user_id, is_active, staff_email, staff_name
  ) VALUES (
    new_user_id, new_user_id, true, 'superadmin-flexlearn@buildstart.io', 'FlexLearn Superadmin'
  );

  UPDATE flexlearn_customization.user_roles SET role = 'super_admin' WHERE user_id = new_user_id;
END;
$$;
SQL
