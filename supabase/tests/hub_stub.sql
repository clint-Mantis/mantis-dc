-- Minimal stand-in for the Mantis Hub objects the DC migrations depend on.
-- For a bare Postgres test database only (NOT for Supabase local, which already has auth/storage):
-- creates roles, auth.users/uid(), storage.objects, public.organisations and private.is_super_admin/is_staff.
do $$ begin create role anon nologin; exception when others then null; end $$; do $$ begin create role authenticated nologin; exception when others then null; end $$; do $$ begin create role service_role nologin bypassrls; exception when others then null; end $$;
create schema auth; create schema storage; create schema private; create schema extensions;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', created_at timestamptz default now(), last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role; grant execute on all functions in schema auth to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
grant usage on schema storage to authenticated, anon, service_role; grant all on storage.objects to authenticated, service_role; grant select on storage.buckets to authenticated;
create type account_status as enum ('active','suspended','cancelled');
create type org_type as enum ('client','corporate','prospect','partner','verification_agency','consultant');
create table public.organisations (id uuid primary key default gen_random_uuid(), name text not null, trading_name text, reg_number text, vat_number text, org_type org_type, status account_status default 'active', created_at timestamptz default now(), created_by uuid, deleted_at timestamptz);
create table public.staff (id uuid primary key default gen_random_uuid(), auth_user_id uuid, is_active boolean default true, display_name text, email text);
create table public.staff_roles (staff_id uuid, role_code text);
create function private.is_super_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists (select 1 from public.staff s join public.staff_roles r on r.staff_id=s.id where s.auth_user_id=(select auth.uid()) and s.is_active and r.role_code='super_admin') $$;
create function private.is_staff() returns boolean language sql stable security definer set search_path='' as $$ select exists (select 1 from public.staff s where s.auth_user_id=(select auth.uid()) and s.is_active) $$;
grant usage on schema public to anon, authenticated, service_role; grant usage on schema private to authenticated; grant execute on all functions in schema private to authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant all on public.organisations to authenticated;
alter table auth.users add column if not exists instance_id uuid, add column if not exists aud text, add column if not exists role text, add column if not exists encrypted_password text, add column if not exists email_confirmed_at timestamptz, add column if not exists raw_app_meta_data jsonb, add column if not exists updated_at timestamptz;
create table if not exists auth.identities (id uuid primary key, user_id uuid, provider_id text, identity_data jsonb, provider text, created_at timestamptz, updated_at timestamptz, unique (provider_id, provider));
create extension if not exists pgcrypto schema extensions;
