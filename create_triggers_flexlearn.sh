#!/bin/bash
docker exec -i supabase-db psql -U postgres -d postgres << 'SQL'
CREATE OR REPLACE FUNCTION flexlearn_customization.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO flexlearn_customization.profiles (user_id, display_name, email)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', new.email);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION flexlearn_customization.handle_new_user_role()
RETURNS trigger AS $$
BEGIN
  INSERT INTO flexlearn_customization.user_roles (user_id, role)
  VALUES (new.id, 'admin');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION flexlearn_customization.handle_new_user_settings()
RETURNS trigger AS $$
BEGIN
  INSERT INTO flexlearn_customization.settings (user_id, key, value)
  VALUES 
    (new.id, 'auto_responses', '{"enabled": true}'),
    (new.id, 'welcome_message', '{"text": "Welcome to our service!"}'),
    (new.id, 'order_notifications', '{"phone": ""}');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_flexlearn ON auth.users;
CREATE TRIGGER on_auth_user_created_flexlearn
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION flexlearn_customization.handle_new_user();

DROP TRIGGER IF EXISTS on_auth_user_created_role_flexlearn ON auth.users;
CREATE TRIGGER on_auth_user_created_role_flexlearn
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION flexlearn_customization.handle_new_user_role();

DROP TRIGGER IF EXISTS on_auth_user_created_settings_flexlearn ON auth.users;
CREATE TRIGGER on_auth_user_created_settings_flexlearn
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION flexlearn_customization.handle_new_user_settings();
SQL
