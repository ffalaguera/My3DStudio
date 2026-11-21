import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { credits, login, makeEnv, WEBHOOK_SECRET, type Env } from './helpers.js';

let env: Env;
const stripe = new Stripe('sk_test_solo_para_firmas');

beforeAll(async () => {
  env = await makeEnv();
  await env.ctx.db.query(`update plans set stripe_price_month_id = 'price_pro_m', stripe_price_year_id = 'price_pro_y' where id = 'pro'`);
});
afterAll(async () => {
  await env.app.closeEvents();
  await env.ctx.db.end();
});

let seq = 0;
function send(type: string, object: object, id = `evt_${Date.now()}_${++seq}`) {
  const payload = JSON.stringify({ id, object: 'event', type, data: { object }, api_version: '2024-12-18.acacia', created: 0, livemode: false });
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return env.api().post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', sig).send(payload);
}

const now = Math.floor(Date.now() / 1000);
const subscription = (customer: string, userId: string, status = 'active') => ({
  id: `sub_${userId.slice(0, 8)}`, object: 'subscription', customer, status, cancel_at_period_end: false, metadata: { user_id: userId },
  current_period_start: now, current_period_end: now + 30 * 86400,
  items: { data: [{ price: { id: 'price_pro_m' }, current_period_start: now, current_period_end: now + 30 * 86400 }] },
});
const invoice = (customer: string) => ({
  id: `in_${++seq}`, object: 'invoice', customer,
  lines: { data: [{ price: { id: 'price_pro_m' }, period: { start: now, end: now + 30 * 86400 } }] },
});

describe('webhook de Stripe', () => {
  it('rechaza firmas no válidas', async () => {
    await env.api().post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', 't=1,v1=falsa')
      .send('{"id":"evt_x"}').expect(400);
    await env.api().post('/api/webhooks/stripe').set('Content-Type', 'application/json').send('{}').expect(400);
  });

  it('alta: la suscripción cambia el plan y la factura pagada concede los créditos una sola vez', async () => {
    const u = await login(env);
    const customer = `cus_${u.id.slice(0, 8)}`;
    await env.ctx.db.query('update profiles set stripe_customer_id = $2 where id = $1', [u.id, customer]);

    expect((await send('customer.subscription.created', subscription(customer, u.id)).expect(200)).body.result).toBe('processed');
    expect((await env.api().get('/api/me').set(u.h)).body.plan.id).toBe('pro');

    const inv = invoice(customer);
    const evId = `evt_factura_${u.id.slice(0, 8)}`;
    expect((await send('invoice.paid', inv, evId).expect(200)).body.result).toBe('processed');
    expect((await send('invoice.paid', inv, evId).expect(200)).body.result).toBe('duplicate'); // Stripe reintenta
    expect(await credits(env, u.h)).toMatchObject({ monthly: 3200, available: 3200 }); // los 200 gratis sin usar se arrastran (F2)
    const ledger = (await env.api().get('/api/credits/ledger').set(u.h)).body.entries;
    expect(ledger.filter((e: { reason: string; delta: number }) => e.reason === 'grant' && e.delta === 3000)).toHaveLength(1);
    expect(ledger.find((e: { reason: string }) => e.reason === 'expire')).toBeUndefined();

    // ahora puede usar privado y topología limpia
    const est = (await env.api().post('/api/tasks/estimate').set(u.h).send({
      type: 'text_to_model', series: 'smart', prompt: 'un cofre', privacy: 'private',
      params: { textureResolution: '4k', pbr: true, texture: true, topology: 'quad', faceLimit: 5000, variants: 2 },
    })).body;
    expect(est).toMatchObject({ allowed: true, credits: 200 });
  });

  it('baja: la suscripción borrada devuelve al plan Gratis', async () => {
    const u = await login(env);
    const customer = `cus_${u.id.slice(0, 8)}`;
    await env.ctx.db.query('update profiles set stripe_customer_id = $2 where id = $1', [u.id, customer]);
    await send('customer.subscription.created', subscription(customer, u.id)).expect(200);
    await send('customer.subscription.deleted', subscription(customer, u.id, 'canceled')).expect(200);
    expect((await env.api().get('/api/me').set(u.h)).body.plan.id).toBe('free');
  });

  it('pago fallido: avisa por email', async () => {
    const u = await login(env);
    const customer = `cus_${u.id.slice(0, 8)}`;
    await env.ctx.db.query('update profiles set stripe_customer_id = $2 where id = $1', [u.id, customer]);
    await send('invoice.payment_failed', invoice(customer)).expect(200);
    expect(env.sent.some((m) => m.to === u.email && m.t.kind === 'payment_failed')).toBe(true);
  });

  it('eventos de clientes desconocidos se ignoran sin error', async () => {
    expect((await send('invoice.paid', invoice('cus_nadie')).expect(200)).body.result).toBe('ignored');
  });
});

describe('packs de créditos (fixes.md F2)', () => {
  const session = (userId: string, packId: string, paid = true) => ({
    id: `cs_${++seq}`, object: 'checkout.session', mode: 'payment', payment_status: paid ? 'paid' : 'unpaid',
    amount_total: ({ pack_800: 1000, pack_2600: 3000, pack_9000: 9000 } as Record<string, number>)[packId] ?? 1000, currency: 'eur',
    client_reference_id: userId, metadata: { user_id: userId, pack_id: packId },
  });

  it('el catálogo de packs es público y trae los de lanzamiento', async () => {
    const packs = (await env.api().get('/api/credit-packs').expect(200)).body.packs as { id: string; credits: number; bonusCredits: number; priceCents: number }[];
    expect(packs.map((p) => p.id)).toEqual(['pack_800', 'pack_2600', 'pack_9000']);
    expect(packs[0]).toMatchObject({ credits: 800, bonusCredits: 0, priceCents: 1000 });
  });

  it('comprar un pack exige sesión y un pack a la venta', async () => {
    await env.api().post('/api/billing/pack').send({ packId: 'pack_800' }).expect(401);
    const u = await login(env);
    await env.api().post('/api/billing/pack').set(u.h).send({ packId: 'pack_800' }).expect(404); // sin precio de Stripe enlazado
  });

  it('pago completado: suma créditos permanentes una sola vez, con el bonus', async () => {
    const u = await login(env);
    const evId = `evt_pack_${u.id.slice(0, 8)}`;
    expect((await send('checkout.session.completed', session(u.id, 'pack_2600'), evId).expect(200)).body.result).toBe('processed');
    expect((await send('checkout.session.completed', session(u.id, 'pack_2600'), evId).expect(200)).body.result).toBe('duplicate');
    expect(await credits(env, u.h)).toMatchObject({ permanent: 2600, available: 2800 });
    const ledger = (await env.api().get('/api/credits/ledger').set(u.h)).body.entries as { reason: string; delta: number; bucket: string }[];
    expect(ledger.filter((e) => e.reason === 'purchase')).toEqual([expect.objectContaining({ delta: 2600, bucket: 'permanent' })]);
  });

  it('sin pagar, pack desconocido o suscripción: no suma nada', async () => {
    const u = await login(env);
    expect((await send('checkout.session.completed', session(u.id, 'pack_800', false)).expect(200)).body.result).toBe('ignored');
    expect((await send('checkout.session.completed', session(u.id, 'pack_falso')).expect(200)).body.result).toBe('ignored');
    expect((await send('checkout.session.completed', { ...session(u.id, 'pack_800'), mode: 'subscription' }).expect(200)).body.result).toBe('ignored');
    expect(await credits(env, u.h)).toMatchObject({ permanent: 0 });
  });

  it('los créditos de un pack no caducan al renovar el mes', async () => {
    const u = await login(env);
    await send('checkout.session.completed', session(u.id, 'pack_800')).expect(200);
    await env.ctx.db.query(`update credit_accounts set monthly_cycle_ends_at = now() - interval '1 minute' where user_id = $1`, [u.id]);
    const { grantFreeCredits } = await import('../src/jobs/worker.js');
    await grantFreeCredits(env.ctx);
    expect(await credits(env, u.h)).toMatchObject({ permanent: 800 });
  });
});
