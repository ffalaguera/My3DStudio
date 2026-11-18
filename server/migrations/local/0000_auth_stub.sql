-- SOLO desarrollo y tests (LOCAL_AUTH=1). En Supabase el esquema auth ya existe.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  created_at timestamptz not null default now()
);
