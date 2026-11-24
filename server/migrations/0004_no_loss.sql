-- «No perder dinero» (decisión del 2026-11-21, replica/launch/pricing.md):
-- ninguna generación sale gratis; cada modelo se paga antes con créditos comprados.

-- El plan sin cuota pasa a ser «Pago por uso»: 0 créditos incluidos. Quien compre packs tiene lo que ha pagado:
-- modelos privados, uso comercial, topología limpia y 30 días de historial.
update plans set name = 'Pago por uso', monthly_credits = 0, free_retries = 0, history_days = 30, max_saved_models = null,
                 allow_private = true, allow_commercial = true, allow_smart_mesh = true, max_texture_resolution = '4k'
 where id = 'free';

-- Sin reintentos gratis en ningún plan: un reintento es otra llamada de pago al motor.
update plans set free_retries = 0;

-- Pack de prueba: 3 modelos por 3 €.
insert into credit_packs (id, credits, bonus_credits, price_cents) values ('pack_150', 150, 0, 300)
on conflict (id) do nothing;

-- Qué pago de Stripe es de quién y de qué: las disputas y reembolsos solo traen el payment_intent.
create table payments (
  payment_intent text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('pack', 'subscription')),
  pack_id text references credit_packs(id),
  credits integer not null default 0 check (credits >= 0),
  created_at timestamptz not null default now()
);
create index payments_user on payments (user_id);
alter table payments enable row level security;

-- Cuentas bloqueadas por disputa o aviso de fraude: no pueden generar ni comprar.
alter table profiles add column blocked_at timestamptz;
alter table profiles add column blocked_reason text check (char_length(blocked_reason) <= 200);
