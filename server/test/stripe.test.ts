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
    expect(await credits(env, u.h)).toMatchObject({ monthly: 3000, available: 3000 });
    const ledger = (await env.api().get('/api/credits/ledger').set(u.h)).body.entries;
    expect(ledger.filter((e: { reason: string; delta: number }) => e.reason === 'grant' && e.delta === 3000)).toHaveLength(1);
    expect(ledger.find((e: { reason: string }) => e.reason === 'expire').delta).toBe(-200); // los 200 gratis caducan

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
