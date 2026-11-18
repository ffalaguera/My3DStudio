-- Lo que necesita el backend además del esquema de architecture.md.

-- Email del perfil para Stripe y correos (copia del de auth.users al entrar).
alter table profiles add column email text;

-- Ciclo en el que se congelaron los créditos: si la tarea se libera tras la renovación,
-- los créditos mensuales devueltos caducan en vez de regalarse.
alter table tasks add column frozen_cycle_ends_at timestamptz;

-- Nombre original del archivo (para nombrar el modelo).
alter table uploads add column filename text check (char_length(filename) <= 200);

-- Planes de pago con precios PROVISIONALES (se fijan en /replica-launch).
-- Los ids de precio de Stripe se rellenan con `npm run seed` desde las variables STRIPE_PRICE_*.
insert into plans (id, name, price_month_cents, price_year_cents, monthly_credits,
                   max_concurrent_tasks, max_batch_size, max_variants,
                   monthly_export_limit, max_saved_models, history_days, free_retries,
                   max_texture_resolution, allow_private, allow_commercial, allow_smart_mesh, sort_order)
values
  -- free_retries: reintentos gratis al mes (cuestan GPU real; null = ilimitados, solo en Max)
  ('pro', 'Pro', 1900, 15600, 3000, 10, 10, 4, null, null, 7, 20, '4k', true, true, true, 1),
  ('max', 'Max', 7900, 64800, 25000, 100, 30, 4, null, null, null, null, '8k', true, true, true, 2);

-- Lista de tareas que el trabajador puede arrancar, de la más antigua a la más nueva.
create index tasks_queued_order on tasks (created_at) where status = 'queued';
