#!/bin/bash
docker exec -i supabase-db psql -U postgres -d postgres -c "DROP SCHEMA IF EXISTS flexlearn_customization CASCADE;"
docker exec supabase-db pg_dump -U postgres -d postgres --schema=public -s -O -x > public_schema.sql
sed -i 's/CREATE SCHEMA public;/CREATE SCHEMA IF NOT EXISTS flexlearn_customization;/g' public_schema.sql
sed -i 's/ALTER SCHEMA public OWNER TO postgres;/\n/g' public_schema.sql
sed -i 's/SET search_path = public, pg_catalog;/SET search_path = flexlearn_customization, pg_catalog;/g' public_schema.sql
sed -i 's/ public\./ flexlearn_customization\./g' public_schema.sql
sed -i 's/public\.plan_tier/flexlearn_customization.plan_tier/g' public_schema.sql
sed -i 's/public\.app_role/flexlearn_customization.app_role/g' public_schema.sql
sed -i 's/public\.has_role/flexlearn_customization.has_role/g' public_schema.sql
sed -i "s/'free'::public.plan_tier/'free'::flexlearn_customization.plan_tier/g" public_schema.sql
sed -i "s/'staff'::public.app_role/'staff'::flexlearn_customization.app_role/g" public_schema.sql
sed -i 's/public\.is_admin/flexlearn_customization.is_admin/g' public_schema.sql
sed -i 's/public\.is_staff_of/flexlearn_customization.is_staff_of/g' public_schema.sql

docker exec -i supabase-db psql -U postgres -d postgres < public_schema.sql
