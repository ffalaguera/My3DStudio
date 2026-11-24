-- Tienda de figuras impresas: el cliente genera su modelo y compra la pieza física. Nunca se le entrega el archivo.
-- El pedido guarda su propia copia del modelo (los modelos del historial caducan) y los datos de envío que da Stripe.

create table print_orders (
  id uuid primary key default gen_random_uuid(),
  -- la cuenta puede borrarse; el pedido se conserva por contabilidad
  user_id uuid references profiles(id) on delete set null,
  asset_id uuid references assets(id) on delete set null,
  asset_name text not null,
  model_key text not null,                       -- copia del GLB en el almacén, solo para imprimir
  size text not null check (size in ('s','m','l')),
  height_mm integer not null check (height_mm between 10 and 400),
  color text not null,
  base boolean not null default false,
  quantity integer not null default 1 check (quantity between 1 and 5),
  unit_cents integer not null check (unit_cents > 0),
  shipping_cents integer not null check (shipping_cents >= 0),
  total_cents integer not null check (total_cents > 0),
  currency text not null default 'eur',
  status text not null default 'pending_payment'
    check (status in ('pending_payment','paid','printing','shipped','cancelled','refunded')),
  email text,
  shipping jsonb,                                -- nombre y dirección (Stripe Checkout)
  stripe_session_id text unique,
  payment_intent text unique,
  tracking text,
  note text,                                     -- nota interna del taller
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  shipped_at timestamptz,
  updated_at timestamptz not null default now()
);
create index print_orders_user on print_orders (user_id, created_at desc);
create index print_orders_queue on print_orders (status, paid_at) where status in ('paid','printing');
