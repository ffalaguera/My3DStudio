import express, { Router } from 'express';
import type Stripe from 'stripe';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { tx, type Tx } from '../db.js';
import { renewMonthly } from '../lib/credits.js';
import { HttpError } from '../lib/http.js';

function requireStripe(ctx: Ctx): Stripe {
  if (!ctx.stripe) throw new HttpError(503, 'billing_disabled', 'Los pagos aún no están configurados');
  return ctx.stripe;
}

async function customerFor(ctx: Ctx, userId: string, email: string): Promise<string> {
  const stripe = requireStripe(ctx);
  const p = await ctx.db.query('select stripe_customer_id from profiles where id = $1', [userId]);
  if (p.rows[0]?.stripe_customer_id) return p.rows[0].stripe_customer_id;
  const c = await stripe.customers.create({ email, metadata: { user_id: userId } }, { idempotencyKey: `customer-${userId}` });
  await ctx.db.query('update profiles set stripe_customer_id = $2 where id = $1 and stripe_customer_id is null', [userId, c.id]);
  return (await ctx.db.query('select stripe_customer_id from profiles where id = $1', [userId])).rows[0].stripe_customer_id;
}

/** Rutas autenticadas: Checkout para suscribirse, Customer Portal para cambiar o cancelar (un clic). */
export function billingRoutes(ctx: Ctx) {
  const r = Router();

  r.post('/checkout', async (req, res) => {
    const stripe = requireStripe(ctx);
    const body = z.object({ planId: z.string().max(20), interval: z.enum(['month', 'year']) }).parse(req.body);
    const plan = await ctx.db.query('select * from plans where id = $1 and is_public', [body.planId]);
    const price = body.interval === 'year' ? plan.rows[0]?.stripe_price_year_id : plan.rows[0]?.stripe_price_month_id;
    if (!price) throw new HttpError(404, 'not_found', 'Ese plan no está a la venta');
    const live = await ctx.db.query(
      `select 1 from subscriptions where user_id = $1 and status in ('active','trialing','past_due')`, [req.user!.id]);
    if (live.rowCount) throw new HttpError(409, 'already_subscribed', 'Ya tienes un plan. Cámbialo desde tu cuenta');
    const customer = await customerFor(ctx, req.user!.id, req.user!.email);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: req.user!.id,
      line_items: [{ price, quantity: 1 }],
      subscription_data: { metadata: { user_id: req.user!.id } },
      success_url: `${ctx.cfg.APP_URL}/cuenta?pago=ok`,
      cancel_url: `${ctx.cfg.APP_URL}/precios`,
      allow_promotion_codes: true,
      automatic_tax: { enabled: false }, // activar cuando haya alta fiscal (ver backend.md)
    });
    res.json({ url: session.url });
  });

  r.post('/portal', async (req, res) => {
    const stripe = requireStripe(ctx);
    const customer = await customerFor(ctx, req.user!.id, req.user!.email);
    const s = await stripe.billingPortal.sessions.create({ customer, return_url: `${ctx.cfg.APP_URL}/cuenta` });
    res.json({ url: s.url });
  });

  return r;
}

// ------------------------------------------------------------------ webhook

const LIVE = ['incomplete', 'trialing', 'active', 'past_due'];

async function planForPrice(c: Tx, priceId: string): Promise<{ id: string; name: string; monthly_credits: number; interval: 'month' | 'year' } | null> {
  const r = await c.query(
    `select id, name, monthly_credits, case when stripe_price_year_id = $1 then 'year' else 'month' end as interval
     from plans where stripe_price_month_id = $1 or stripe_price_year_id = $1`, [priceId]);
  return r.rows[0] ?? null;
}

async function userForCustomer(c: Tx, customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): Promise<string | null> {
  const id = typeof customer === 'string' ? customer : customer?.id;
  if (!id) return null;
  return (await c.query('select id from profiles where stripe_customer_id = $1', [id])).rows[0]?.id ?? null;
}

/** Aplica un evento ya verificado. Idempotente: el id del evento se guarda en la misma transacción. */
export async function handleStripeEvent(ctx: Ctx, event: Stripe.Event): Promise<'processed' | 'duplicate' | 'ignored'> {
  return tx(ctx.db, async (c) => {
    const seen = await c.query('insert into stripe_events (id, type) values ($1,$2) on conflict do nothing returning id', [event.id, event.type]);
    if (!seen.rowCount) return 'duplicate';

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const s = event.data.object as Stripe.Subscription;
        const metaUser = s.metadata?.['user_id'];
        const userId = (metaUser && (await c.query('select 1 from profiles where id = $1', [metaUser])).rowCount ? metaUser : null)
          ?? (await userForCustomer(c, s.customer));
        const item = s.items.data[0];
        const plan = item ? await planForPrice(c, item.price.id) : null;
        // usuario borrado o precio que no es nuestro: se registra y no se reintenta
        if (!userId || !plan) return 'ignored';
        const status = event.type === 'customer.subscription.deleted' ? 'canceled' : s.status;
        const start = new Date(((item as unknown as { current_period_start?: number }).current_period_start ?? (s as unknown as { current_period_start: number }).current_period_start) * 1000);
        const end = new Date(((item as unknown as { current_period_end?: number }).current_period_end ?? (s as unknown as { current_period_end: number }).current_period_end) * 1000);
        await c.query(
          `insert into subscriptions (user_id, plan_id, billing_interval, status, stripe_subscription_id,
                                      current_period_start, current_period_end, cancel_at_period_end)
           values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (stripe_subscription_id) do update set plan_id = excluded.plan_id, billing_interval = excluded.billing_interval,
             status = excluded.status, current_period_start = excluded.current_period_start,
             current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end`,
          [userId, plan.id, plan.interval, status, s.id, start, end, s.cancel_at_period_end],
        );
        const anyLive = await c.query(`select plan_id from subscriptions where user_id = $1 and status = any($2) order by updated_at desc limit 1`,
          [userId, LIVE]);
        await c.query('update profiles set plan_id = $2 where id = $1', [userId, anyLive.rows[0]?.plan_id ?? 'free']);
        if (!anyLive.rowCount) {
          // vuelve a gratis: la bolsa mensual pasa a la del plan gratuito en la próxima renovación (job mensual)
        }
        return 'processed';
      }
      case 'invoice.paid': {
        // Cada factura pagada (alta y renovaciones) concede los créditos del periodo.
        const inv = event.data.object as Stripe.Invoice;
        const line = inv.lines.data.find((l) => (l as unknown as { price?: { id: string } }).price?.id
          || (l as unknown as { pricing?: { price_details?: { price: string } } }).pricing?.price_details?.price);
        const priceId = (line as unknown as { price?: { id: string } })?.price?.id
          ?? (line as unknown as { pricing?: { price_details?: { price: string } } })?.pricing?.price_details?.price;
        const userId = await userForCustomer(c, inv.customer);
        const plan = priceId ? await planForPrice(c, priceId) : null;
        if (!userId || !plan || !line) return 'ignored';
        const end = new Date(line.period.end * 1000);
        await renewMonthly(c, userId, plan.monthly_credits, end,
          `Plan ${plan.name} (${plan.interval === 'year' ? 'anual' : 'mensual'})`, event.id);
        return 'processed';
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        const userId = await userForCustomer(c, inv.customer);
        if (!userId) return 'ignored';
        const p = await c.query('select email, plan_id from profiles where id = $1', [userId]);
        if (p.rows[0]?.email && ctx.stripe) {
          const portal = `${ctx.cfg.APP_URL}/cuenta`;
          const plan = (await c.query('select name from plans where id = $1', [p.rows[0].plan_id])).rows[0]?.name ?? 'de pago';
          await ctx.mailer.send(p.rows[0].email, { kind: 'payment_failed', planName: plan, portalUrl: portal });
        }
        return 'processed';
      }
      default:
        return 'ignored';
    }
  });
}

/** Sin JWT: Stripe firma el cuerpo crudo. La firma se verifica antes de tocar nada. */
export function stripeWebhook(ctx: Ctx) {
  const r = Router();
  r.post('/', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    if (!ctx.stripe || !ctx.cfg.STRIPE_WEBHOOK_SECRET) throw new HttpError(503, 'billing_disabled', 'Pagos no configurados');
    let event: Stripe.Event;
    try {
      event = ctx.stripe.webhooks.constructEvent(req.body as Buffer, req.header('stripe-signature') ?? '', ctx.cfg.STRIPE_WEBHOOK_SECRET);
    } catch {
      throw new HttpError(400, 'bad_signature', 'Firma no válida');
    }
    const result = await handleStripeEvent(ctx, event);
    res.json({ received: true, result });
  });
  return r;
}
