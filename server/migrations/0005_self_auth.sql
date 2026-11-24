-- Acceso propio con Better Auth (AUTH_PROVIDER=self). Generado con getMigrations de better-auth 1.7.18
-- (replica/security.md). Se crea siempre: con Supabase o LOCAL_AUTH las tablas quedan vacías.

create table "ba_user" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);
create table "ba_session" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" uuid not null references "ba_user" ("id") on delete cascade);
create table "ba_account" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "accountId" text not null, "providerId" text not null, "userId" uuid not null references "ba_user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);
create table "ba_verification" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);
create index "ba_session_userId_idx" on "ba_session" ("userId");
create index "ba_account_userId_idx" on "ba_account" ("userId");
create index "ba_verification_identifier_idx" on "ba_verification" ("identifier");

-- Nadie fuera de la API puede leer sesiones ni cuentas (por si la base se expone con la anon key de Supabase).
alter table "ba_user" enable row level security;
alter table "ba_session" enable row level security;
alter table "ba_account" enable row level security;
alter table "ba_verification" enable row level security;
