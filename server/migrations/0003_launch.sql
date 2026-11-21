-- Tarifa de lanzamiento (replica/launch/pricing.md, 2026-11-21).
-- Un modelo de alto detalle cuesta 50 créditos (CREDITS_HD). Con el motor en fal (~0,28 € por modelo)
-- cada plan deja margen aunque el usuario gaste todos sus créditos.

-- Gratis: 2 modelos al mes, y lo que generes se descarga siempre (fixes.md F1: sin límite de exportaciones).
update plans set monthly_credits = 100, monthly_export_limit = null where id = 'free';

-- Creador (id 'pro'): 30 modelos al mes. Anual = 10 meses.
update plans set name = 'Creador', price_month_cents = 1500, price_year_cents = 15000, monthly_credits = 1500,
                 max_concurrent_tasks = 5, free_retries = 10
 where id = 'pro';

-- Estudio (id 'max'): 100 modelos al mes. Anual = 10 meses.
update plans set name = 'Estudio', price_month_cents = 4900, price_year_cents = 49000, monthly_credits = 5000,
                 max_concurrent_tasks = 20, free_retries = 40
 where id = 'max';

-- Packs sin caducidad, para usuarios ocasionales (fixes.md F2 y posicionamiento C).
-- Los ids de precio de Stripe se enlazan con `npm run seed` desde STRIPE_PRICE_PACK_*.
insert into credit_packs (id, credits, bonus_credits, price_cents) values
  ('pack_800', 800, 0, 1000),
  ('pack_2600', 2400, 200, 3000),
  ('pack_9000', 8000, 1000, 9000)
on conflict (id) do nothing;
