-- Esquema inicial del clon de Tripo Studio. Postgres 15+ en Supabase (región UE).
-- Reglas de acceso: Express es el único cliente y filtra por user_id en cada consulta
-- (las fichas públicas filtran por privacy = 'public'). RLS activado sin políticas en
-- todas las tablas, para que la clave anónima de Supabase no pueda leer ni escribir nada.
-- Tiempos en timestamptz (UTC). Dinero en céntimos enteros + moneda.
-- Créditos: modelo "congelar y luego consumir". Al crear la tarea los créditos pasan del
-- saldo a "congelado"; si sale bien se consumen; si falla o se cancela se liberan.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ================================================================ planes y usuarios

create table plans (
  id text primary key,                                   -- 'free', 'pro', 'max'
  name text not null,
  price_month_cents integer not null check (price_month_cents >= 0),
  price_year_cents integer not null check (price_year_cents >= 0),
  currency text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  monthly_credits integer not null check (monthly_credits >= 0),
  max_concurrent_tasks integer not null check (max_concurrent_tasks > 0),
  max_batch_size integer not null default 1 check (max_batch_size > 0),
  max_variants smallint not null default 1 check (max_variants in (1, 2, 4)),
  monthly_export_limit integer,                          -- null = sin límite
  max_saved_models integer,                              -- null = sin límite
  history_days integer,                                  -- null = permanente
  free_retries integer,                                  -- null = ilimitados
  max_texture_resolution text not null default '2k' check (max_texture_resolution in ('2k','4k','8k')),
  allow_private boolean not null default false,
  allow_commercial boolean not null default false,
  allow_smart_mesh boolean not null default false,
  stripe_price_month_id text,
  stripe_price_year_id text,
  is_public boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger plans_updated before update on plans for each row execute function set_updated_at();

create table credit_packs (
  id text primary key,                                   -- 'pack_1000', ...
  credits integer not null check (credits > 0),
  bonus_credits integer not null default 0 check (bonus_credits >= 0),
  price_cents integer not null check (price_cents > 0),
  currency text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  stripe_price_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger credit_packs_updated before update on credit_packs for each row execute function set_updated_at();

-- Un perfil por usuario de Supabase Auth. Borrar el usuario borra todo lo suyo.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique check (username ~ '^[a-z0-9_]{3,30}$'),   -- para fichas públicas
  display_name text check (char_length(display_name) <= 60),
  avatar_key text,
  plan_id text not null default 'free' references plans(id) on delete restrict,
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on profiles (plan_id);
create trigger profiles_updated before update on profiles for each row execute function set_updated_at();

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  plan_id text not null references plans(id) on delete restrict,
  billing_interval text not null check (billing_interval in ('month','year')),
  status text not null check (status in
    ('incomplete','trialing','active','past_due','canceled','unpaid')),
  stripe_subscription_id text not null unique,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint period_order check (current_period_end > current_period_start)
);
create index on subscriptions (user_id);
create index on subscriptions (plan_id);
create unique index one_live_subscription on subscriptions (user_id)
  where status in ('incomplete','trialing','active','past_due');
create trigger subscriptions_updated before update on subscriptions for each row execute function set_updated_at();

-- ================================================================ créditos

-- Saldos actuales. Se bloquea con SELECT ... FOR UPDATE en cada movimiento.
-- monthly caduca al final del ciclo; permanent (packs, regalos) no caduca.
-- frozen_* = reservado por tareas en cola o en curso, separado por bolsa para
-- poder devolverlo a la bolsa de la que salió.
create table credit_accounts (
  user_id uuid primary key references profiles(id) on delete cascade,
  monthly_balance integer not null default 0,
  permanent_balance integer not null default 0,
  frozen_monthly integer not null default 0,
  frozen_permanent integer not null default 0,
  monthly_cycle_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint balances_not_negative check (
    monthly_balance >= 0 and permanent_balance >= 0
    and frozen_monthly >= 0 and frozen_permanent >= 0)
);
create trigger credit_accounts_updated before update on credit_accounts for each row execute function set_updated_at();

-- Cada movimiento, en la misma transacción que cambia credit_accounts.
--   grant / purchase / adjust : +saldo
--   freeze                    : -saldo, +congelado      (delta negativo)
--   consume                   : -congelado              (delta negativo)
--   release                   : +saldo, -congelado      (delta positivo)
--   expire                    : -saldo mensual          (delta negativo)
create table credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  bucket text not null check (bucket in ('monthly','permanent')),
  delta integer not null check (delta <> 0),
  reason text not null check (reason in
    ('grant','purchase','freeze','consume','release','expire','adjust')),
  task_id uuid,                                          -- FK tras crear tasks
  stripe_event_id text,
  note text,
  created_at timestamptz not null default now()
);
create index on credit_ledger (user_id, created_at desc);
create index on credit_ledger (task_id);
-- Una tarea se congela, se consume y se libera como mucho una vez por bolsa.
create unique index one_freeze_per_task  on credit_ledger (task_id, bucket) where reason = 'freeze';
create unique index one_consume_per_task on credit_ledger (task_id, bucket) where reason = 'consume';
create unique index one_release_per_task on credit_ledger (task_id, bucket) where reason = 'release';
-- Un evento de Stripe concede créditos una sola vez.
create unique index one_grant_per_event on credit_ledger (stripe_event_id, bucket)
  where stripe_event_id is not null;

-- ================================================================ subidas

create table uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('image','model')),
  storage_key text not null unique,
  content_type text not null check (content_type in (
    'image/jpeg','image/png','image/webp',
    'model/gltf-binary','model/obj','model/stl','application/octet-stream')),
  size_bytes bigint not null check (size_bytes > 0),
  width integer check (width > 0),
  height integer check (height > 0),
  status text not null default 'pending' check (status in ('pending','ready','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint size_limit check (
    (kind = 'image' and size_bytes <= 20 * 1024 * 1024) or
    (kind = 'model' and size_bytes <= 150 * 1024 * 1024))
);
create index on uploads (user_id, created_at desc);
create index uploads_cleanup on uploads (created_at) where status = 'pending';
create trigger uploads_updated before update on uploads for each row execute function set_updated_at();

-- ================================================================ tareas

create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null check (type in (
    'text_to_model','image_to_model','multiview_to_model',
    'generate_image','retexture','retopo','smart_uv','segment','rig','animate',
    'convert','import')),
  series text check (series in ('hd','smart')),          -- HD (alto detalle) o Smart Mesh
  status text not null default 'queued' check (status in
    ('queued','running','success','failed','cancelled')),
  progress smallint not null default 0 check (progress between 0 and 100),
  prompt text check (char_length(prompt) <= 1024),
  texture_prompt text check (char_length(texture_prompt) <= 1024),
  params jsonb not null default '{}',                    -- texture_resolution, pbr, ultra, topology, face_limit, variants...
  model_version text,                                    -- versión del motor usada
  input_asset_id uuid,                                   -- FK tras crear assets (post-procesado)
  parent_task_id uuid references tasks(id) on delete set null,
  retry_of_task_id uuid references tasks(id) on delete set null,
  batch_id uuid,                                         -- tareas creadas juntas por lote
  privacy text not null default 'public' check (privacy in ('public','private')),
  idempotency_key text not null,
  provider text,                                         -- 'fake', 'fal', 'trellis', 'local'
  provider_task_id text,
  credits_cost integer not null default 0 check (credits_cost >= 0),
  is_free_retry boolean not null default false,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint finished_has_time check (
    status not in ('success','failed','cancelled') or finished_at is not null),
  constraint generation_has_series check (
    type not in ('text_to_model','image_to_model','multiview_to_model') or series is not null),
  constraint text_needs_prompt check (type <> 'text_to_model' or prompt is not null)
);
create unique index tasks_idempotency on tasks (user_id, idempotency_key);
create index on tasks (user_id, created_at desc);
create index tasks_active on tasks (user_id) where status in ('queued','running');
create index tasks_global_queue on tasks (created_at) where status = 'queued';
create index tasks_stuck on tasks (started_at) where status = 'running';
create index on tasks (input_asset_id);
create index on tasks (parent_task_id);
create index on tasks (retry_of_task_id);
create index on tasks (batch_id) where batch_id is not null;
create index on tasks (provider, provider_task_id);
create trigger tasks_updated before update on tasks for each row execute function set_updated_at();

alter table credit_ledger
  add constraint credit_ledger_task_fk foreign key (task_id) references tasks(id) on delete set null;

-- Imágenes de entrada de una tarea: 1 (imagen) o 2-4 (multivista).
create table task_inputs (
  task_id uuid not null references tasks(id) on delete cascade,
  upload_id uuid not null references uploads(id) on delete restrict,
  view text not null default 'single' check (view in ('single','front','left','back','right')),
  primary key (task_id, view)
);
create index on task_inputs (upload_id);

-- ================================================================ modelos (assets)

create table assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,  -- tarea que lo creó
  variant_index smallint not null default 0 check (variant_index between 0 and 3),
  parent_asset_id uuid references assets(id) on delete set null,  -- de qué se derivó
  kind text not null check (kind in ('model','image')),
  source text not null check (source in ('generated','uploaded')),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9-]{1,80}$'),
  prompt text,                                           -- copia para la ficha pública
  series text check (series in ('hd','smart')),
  model_version text,
  thumbnail_key text,
  face_count integer check (face_count >= 0),
  vertex_count integer check (vertex_count >= 0),
  topology text check (topology in ('tri','quad','mixed')),
  texture_resolution text check (texture_resolution in ('2k','4k','8k')),
  has_texture boolean not null default false,
  has_pbr boolean not null default false,
  is_rigged boolean not null default false,
  is_animated boolean not null default false,
  privacy text not null default 'public' check (privacy in ('public','private')),
  license text not null check (license in ('attribution','commercial')),
  expires_at timestamptz,                                -- historial limitado por plan
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on assets (user_id, created_at desc);
create unique index one_asset_per_variant on assets (task_id, variant_index) where task_id is not null;
create index on assets (parent_asset_id);
create index assets_public on assets (created_at desc) where privacy = 'public' and kind = 'model';
create index assets_expiring on assets (expires_at) where expires_at is not null;
create index assets_name_trgm on assets using gin (name gin_trgm_ops);
create trigger assets_updated before update on assets for each row execute function set_updated_at();

alter table tasks
  add constraint tasks_input_asset_fk foreign key (input_asset_id) references assets(id) on delete set null;

create table asset_files (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  format text not null check (format in ('glb','fbx','obj','usdz','stl','3mf','png','zip')),
  options_hash text not null default 'default',          -- p. ej. con/sin texturas
  storage_key text not null unique,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  unique (asset_id, format, options_hash)
);

create table texture_maps (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  map text not null check (map in ('base_color','metallic','normal','roughness','emission')),
  resolution text not null check (resolution in ('2k','4k','8k')),
  storage_key text not null unique,
  created_at timestamptz not null default now(),
  unique (asset_id, map)
);

-- Cada exportación, para el límite mensual del plan gratuito.
create table exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  asset_id uuid references assets(id) on delete set null,
  format text not null,
  created_at timestamptz not null default now()
);
create index on exports (user_id, created_at);
create index on exports (asset_id);

-- ================================================================ galería pública (could)

create table tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name ~ '^[a-z0-9 -]{1,40}$'),
  is_category boolean not null default false,            -- Character, Vehicle, Animal...
  created_at timestamptz not null default now()
);

create table asset_tags (
  asset_id uuid not null references assets(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  primary key (asset_id, tag_id)
);
create index on asset_tags (tag_id);

-- "Collected" en Mis assets.
create table collections (
  user_id uuid not null references profiles(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, asset_id)
);
create index on collections (asset_id);

create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references profiles(id) on delete set null,
  asset_id uuid not null references assets(id) on delete cascade,
  reason text not null check (reason in ('ip','nsfw','violence','spam','other')),
  details text check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open','actioned','dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reporter_id, asset_id)
);
create index reports_open on reports (created_at) where status = 'open';
create index on reports (asset_id);
create trigger reports_updated before update on reports for each row execute function set_updated_at();

-- ================================================================ Stripe

create table stripe_events (
  id text primary key,                                   -- id del evento de Stripe
  type text not null,
  processed_at timestamptz not null default now()
);

-- ================================================================ RLS: todo cerrado

alter table plans enable row level security;
alter table credit_packs enable row level security;
alter table profiles enable row level security;
alter table subscriptions enable row level security;
alter table credit_accounts enable row level security;
alter table credit_ledger enable row level security;
alter table uploads enable row level security;
alter table tasks enable row level security;
alter table task_inputs enable row level security;
alter table assets enable row level security;
alter table asset_files enable row level security;
alter table texture_maps enable row level security;
alter table exports enable row level security;
alter table tags enable row level security;
alter table asset_tags enable row level security;
alter table collections enable row level security;
alter table reports enable row level security;
alter table stripe_events enable row level security;

-- ================================================================ datos iniciales

-- Solo el plan gratuito. Precios y planes de pago se fijan en /replica-launch.
insert into plans (id, name, price_month_cents, price_year_cents, monthly_credits,
                   max_concurrent_tasks, max_batch_size, max_variants,
                   monthly_export_limit, max_saved_models, history_days, free_retries,
                   max_texture_resolution, allow_private, allow_commercial, allow_smart_mesh)
values ('free', 'Gratis', 0, 0, 200, 1, 1, 1, 15, 10, 1, 3, '2k', false, false, false);
