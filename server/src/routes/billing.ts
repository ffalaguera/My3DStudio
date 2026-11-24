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

/** Una cuenta bloqueada por disputa o fraude no puede volver a comprar. */
async function assertNotBlocked(ctx: Ctx, userId: string): Promise<void> {
  const p = await ctx.db.query('select blocked_at from profiles where id = $1', [userId]);
  if (p.rows[0]?.blocked_at) throw new HttpError(403, 'account_blocked', 'Tu cuenta está bloqueada por una incidencia con un pago. Escríbenos para resolverlo');
}

/** 3D Secure siempre: el banco del titular confirma el pago y, si es fraude, la responsabilidad pasa al banco. */
const SCA = { card: { request_three_d_secure: 'any' as const } };

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
    await assertNotBlocked(ctx, req.user!.id);
    const customer = await customerFor(ctx, req.user!.id, req.user!.email);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: req.user!.id,
      line_items: [{ price, quantity: 1 }],
      subscription_data: { metadata: { user_id: req.user!.id } },
      payment_method_options: SCA,
      success_url: `${ctx.cfg.APP_URL}/cuenta?pago=ok`,
      cancel_url: `${ctx.cfg.APP_URL}/precios`,
      allow_promotion_codes: true,
      automatic_tax: { enabled: false }, // activar cuando haya alta fiscal (ver backend.md)
    });
    res.json({ url: session.url });
  });

  // Pack de créditos: pago único con Checkout. Los créditos llegan con checkout.session.completed.
  r.post('/pack', async (req, res) => {
    const stripe = requireStripe(ctx);
    const body = z.object({ packId: z.string().max(40) }).parse(req.body);
    const pack = await ctx.db.query('select id, stripe_price_id from credit_packs where id = $1 and is_active', [body.packId]);
    const price = pack.rows[0]?.stripe_price_id;
    if (!price) throw new HttpError(404, 'not_found', 'Ese pack no está a la venta');
    await assertNotBlocked(ctx, req.user!.id);
    const customer = await customerFor(ctx, req.user!.id, req.user!.email);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer,
      client_reference_id: req.user!.id,
      line_items: [{ price, quantity: 1 }],
      metadata: { user_id: req.user!.id, pack_id: body.packId },
      // también en el pago: los reembolsos y disputas llegan con el payment_intent
      payment_intent_data: { metadata: { user_id: req.user!.id, pack_id: body.packId } },
      payment_method_options: SCA,
      success_url: `${ctx.cfg.APP_URL}/cuenta?pack=ok`,
      cancel_url: `${ctx.cfg.APP_URL}/precios`,
      automatic_tax: { enabled: false },
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

/** Usuario de un pago: por la tabla payments (packs) o por el cliente de Stripe del cargo. */
async function userForPayment(c: Tx, pi: string | { id: string } | null | undefined,
  charge: string | { id: string; customer?: string | null } | undefined): Promise<string | null> {
  const piId = typeof pi === 'string' ? pi : pi?.id;
  if (piId) {
    const p = await c.query('select user_id from payments where payment_intent = $1', [piId]);
    if (p.rowCount) return p.rows[0].user_id;
    const o = await c.query('select user_id from print_orders where payment_intent = $1 and user_id is not null', [piId]);
    if (o.rowCount) return o.rows[0].user_id;
  }
  return typeof charge === 'object' && charge?.customer ? userForCustomer(c, charge.customer) : null;
}

/** Bloquea la cuenta y deja sus créditos a cero (con su apunte en el historial). */
async function blockAndRevoke(c: Tx, userId: string, reason: string): Promise<void> {
  await c.query('update profiles set blocked_at = coalesce(blocked_at, now()), blocked_reason = $2 where id = $1', [userId, reason]);
  const a = (await c.query('select monthly_balance, permanent_balance from credit_accounts where user_id = $1 for update', [userId])).rows[0];
  if (!a) return;
  for (const [bucket, amount] of [['monthly', a.monthly_balance], ['permanent', a.permanent_balance]] as const) {
    if (amount > 0) {
      await c.query(`insert into credit_ledger (user_id,bucket,delta,reason,note) values ($1,$2,$3,'adjust',$4)`,
        [userId, bucket, -amount, `Retirados: ${reason.toLowerCase()}`]);
    }
  }
  await c.query('update credit_accounts set monthly_balance = 0, permanent_balance = 0 where user_id = $1', [userId]);
}

/** Pedido de figura pagado: se comprueba el importe y se guardan la dirección y el pago. */
async function payOrder(ctx: Ctx, c: Tx, s: Stripe.Checkout.Session): Promise<'processed' | 'ignored'> {
  const id = s.metadata!['order_id']!;
  const o = (await c.query('select status, total_cents, currency, user_id from print_orders where id = $1 for update', [id])).rows[0];
  if (!o) return 'ignored';
  if (s.amount_total !== o.total_cents || s.currency !== o.currency) {
    ctx.security.record({ kind: 'payment_mismatch', userId: o.user_id ?? undefined,
      detail: `pedido ${id.slice(0, 8)}: cobrado ${s.amount_total} ${s.currency}, precio ${o.total_cents} ${o.currency}` });
    return 'ignored';
  }
  if (o.status !== 'pending_payment') return 'ignored';
  const ship = (s as unknown as { collected_information?: { shipping_details?: unknown } }).collected_information?.shipping_details
    ?? (s as unknown as { shipping_details?: unknown }).shipping_details ?? null;
  const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id ?? null;
  await c.query(
    `update print_orders set status = 'paid', paid_at = now(), updated_at = now(), shipping = $2, payment_intent = $3,
            email = coalesce($4, email), stripe_session_id = coalesce(stripe_session_id, $5)
      where id = $1`,
    [id, ship ? JSON.stringify({ ...(ship as object), phone: s.customer_details?.phone ?? null }) : null, pi, s.customer_details?.email ?? null, s.id]);
  return 'processed';
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
      case 'checkout.session.completed': {
        // Packs y pedidos de figuras (pago único). Las suscripciones se gestionan con customer.subscription.* e invoice.paid.
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.mode !== 'payment' || s.payment_status !== 'paid') return 'ignored';
        if (s.metadata?.['order_id']) return payOrder(ctx, c, s);
        const userId = s.metadata?.['user_id'] ?? s.client_reference_id;
        const packId = s.metadata?.['pack_id'];
        if (!userId || !packId) return 'ignored';
        const pack = (await c.query('select credits, bonus_credits, price_cents, currency from credit_packs where id = $1', [packId])).rows[0];
        const user = await c.query('select 1 from credit_accounts where user_id = $1 for update', [userId]);
        if (!pack || !user.rowCount) return 'ignored';
        // El importe lo cobra Stripe, pero se comprueba aquí: solo se dan créditos si se pagó el precio del pack.
        if (s.amount_total !== pack.price_cents || s.currency !== pack.currency) {
          ctx.security.record({ kind: 'payment_mismatch', userId,
            detail: `${packId}: cobrado ${s.amount_total} ${s.currency}, precio ${pack.price_cents} ${pack.currency}` });
          return 'ignored';
        }
        const total = pack.credits + pack.bonus_credits;
        await c.query('update credit_accounts set permanent_balance = permanent_balance + $2 where user_id = $1', [userId, total]);
        await c.query(`insert into credit_ledger (user_id,bucket,delta,reason,note,stripe_event_id) values ($1,'permanent',$2,'purchase',$3,$4)`,
          [userId, total, `Pack de ${pack.credits}${pack.bonus_credits ? ` + ${pack.bonus_credits} de regalo` : ''} créditos`, event.id]);
        const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
        if (pi) {
          await c.query(`insert into payments (payment_intent, user_id, kind, pack_id, credits) values ($1,$2,'pack',$3,$4) on conflict do nothing`,
            [pi, userId, packId, total]);
        }
        return 'processed';
      }
      case 'charge.dispute.created':
      case 'radar.early_fraud_warning.created': {
        // Chargeback o aviso de fraude del banco: se bloquea la cuenta y se retiran sus créditos para que no genere más.
        const o = event.data.object as { payment_intent?: string | { id: string } | null; charge?: string | { id: string; customer?: string | null } };
        const userId = await userForPayment(c, o.payment_intent, o.charge);
        if (!userId) return 'ignored';
        const piId = typeof o.payment_intent === 'string' ? o.payment_intent : o.payment_intent?.id;
        // un pedido en disputa no se imprime ni se envía
        if (piId) await c.query(`update print_orders set note = concat_ws(' · ', note, 'DISPUTA: no enviar'), updated_at = now() where payment_intent = $1`, [piId]);
        await blockAndRevoke(c, userId, event.type === 'charge.dispute.created' ? 'Disputa de un pago' : 'Aviso de fraude del banco');
        ctx.security.record({ kind: 'payment_dispute', userId, detail: event.type });
        return 'processed';
      }
      case 'charge.refunded': {
        // Reembolso (lo haces tú desde Stripe): se retiran los créditos de esa compra que queden sin gastar.
        const ch = event.data.object as Stripe.Charge;
        const pi = typeof ch.payment_intent === 'string' ? ch.payment_intent : ch.payment_intent?.id;
        // reembolso de un pedido de figura: se marca el pedido; no hay créditos que retirar
        if (pi) {
          const ord = await c.query(`update print_orders set status = 'refunded', updated_at = now() where payment_intent = $1 returning user_id`, [pi]);
          if (ord.rowCount) {
            ctx.security.record({ kind: 'payment_refund', userId: ord.rows[0].user_id ?? undefined, detail: 'pedido reembolsado' });
            return 'processed';
          }
        }
        const pay = pi ? (await c.query('select user_id, kind, credits from payments where payment_intent = $1', [pi])).rows[0] : null;
        const userId = pay?.user_id ?? (await userForCustomer(c, ch.customer));
        if (!userId) return 'ignored';
        const a = (await c.query('select monthly_balance, permanent_balance from credit_accounts where user_id = $1 for update', [userId])).rows[0];
        if (!a) return 'ignored';
        const bucket = pay?.kind === 'pack' ? 'permanent' : 'monthly';
        const have = bucket === 'permanent' ? a.permanent_balance : a.monthly_balance;
        const take = Math.min(have, pay?.kind === 'pack' ? pay.credits : have);
        if (take > 0) {
          await c.query(`update credit_accounts set ${bucket}_balance = ${bucket}_balance - $2 where user_id = $1`, [userId, take]);
          await c.query(`insert into credit_ledger (user_id,bucket,delta,reason,note) values ($1,$2,$3,'adjust','Reembolso de un pago')`,
            [userId, bucket, -take]);
        }
        ctx.security.record({ kind: 'payment_refund', userId, detail: `${take} créditos retirados` });
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
