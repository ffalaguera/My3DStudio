import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { dispatch } from '../src/jobs/worker.js';
import { createSecurityLog } from '../src/lib/security-log.js';
import { credits, login, makeEnv, PARAMS, WEBHOOK_SECRET, type Env } from './helpers.js';

// «No perder dinero» (replica/launch/pricing.md): sin generaciones gratis, sin reintentos gratis,
// fraude y devoluciones cerrados, y un tope diario de llamadas al motor de pago.
let env: Env;
const lines: Record<string, unknown>[] = [];
const stripe = new Stripe('sk_test_solo_para_firmas');

beforeAll(async () => {
  env = await makeEnv({ realPlans: true });
  env.ctx.security = createSecurityLog({ sink: (e) => void lines.push(e) });
});
afterAll(async () => {
  await env.app.closeEvents();
  await env.ctx.db.end();
});

let seq = 0;
function send(type: string, object: object) {
  const payload = JSON.stringify({ id: `evt_nl_${++seq}_${Date.now()}`, object: 'event', type, data: { object }, api_version: '2024-12-18.acacia', created: 0, livemode: false });
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return env.api().post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', sig).send(payload);
}
const textTask = (prompt: string) => ({ type: 'text_to_model', series: 'hd', prompt, privacy: 'public', params: PARAMS });
/** Compra un pack como lo notifica Stripe; devuelve el id del pago (payment_intent). */
async function buyPack(userId: string, packId = 'pack_150', cents = 300): Promise<string> {
  const pi = `pi_${++seq}_${userId.slice(0, 6)}`;
  await send('checkout.session.completed', {
    id: `cs_${seq}`, object: 'checkout.session', mode: 'payment', payment_status: 'paid', amount_total: cents, currency: 'eur',
    payment_intent: pi, client_reference_id: userId, metadata: { user_id: userId, pack_id: packId },
  }).expect(200);
  return pi;
}

describe('sin generaciones gratis', () => {
  it('una cuenta nueva no recibe créditos y no puede generar', async () => {
    const u = await login(env);
    expect(await credits(env, u.h)).toMatchObject({ available: 0, monthly: 0, permanent: 0 });
    const r = await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID()).send(textTask('una caja')).expect(402);
    expect(r.body.error.code).toBe('insufficient_credits');
  });

  it('el plan sin cuota es «Pago por uso»: lo comprado en packs da modelos privados, comerciales y guardados 30 días', async () => {
    const free = (await env.api().get('/api/plans').expect(200)).body.plans.find((p: { id: string }) => p.id === 'free');
    expect(free).toMatchObject({ name: 'Pago por uso', monthlyCredits: 0, allowPrivate: true, allowCommercial: true, historyDays: 30 });
  });

  it('el pack de prueba (3 €) existe y da 3 modelos', async () => {
    const packs = (await env.api().get('/api/credit-packs')).body.packs as { id: string; credits: number; priceCents: number }[];
    expect(packs[0]).toMatchObject({ id: 'pack_150', credits: 150, priceCents: 300 });
  });
});

describe('sin reintentos gratis', () => {
  it('reintentar un modelo terminado cuesta lo mismo que generarlo', async () => {
    const u = await login(env);
    await buyPack(u.id);
    const t = (await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID()).send(textTask('un jarrón')).expect(201)).body.task;
    await env.ctx.db.query(`update tasks set status = 'success', finished_at = now() where id = $1`, [t.id]);
    await env.ctx.db.query(`update credit_accounts set frozen_permanent = 0 where user_id = $1`, [u.id]);
    const before = (await credits(env, u.h)).available;
    const r = (await env.api().post(`/api/tasks/${t.id}/retry`).set(u.h).set('Idempotency-Key', randomUUID()).expect(201)).body.task;
    expect(r.creditsCost).toBe(50);
    expect((await credits(env, u.h)).available).toBe(before - 50);
  });
});

describe('fraude y devoluciones', () => {
  it('Checkout exige 3D Secure (el fraude con tarjeta robada pasa al banco) y guarda el pack en el pago', async () => {
    const u = await login(env);
    await env.ctx.db.query(`update credit_packs set stripe_price_id = 'price_pack_150' where id = 'pack_150'`);
    const create = vi.fn(async (_p: Stripe.Checkout.SessionCreateParams) => ({ url: 'https://checkout.stripe.com/x' }));
    const original = env.ctx.stripe!.checkout.sessions.create;
    const originalCustomer = env.ctx.stripe!.customers.create;
    (env.ctx.stripe!.checkout.sessions as unknown as { create: typeof create }).create = create;
    (env.ctx.stripe!.customers as unknown as { create: () => Promise<{ id: string }> }).create = async () => ({ id: `cus_${u.id.slice(0, 8)}` });
    try {
      await env.api().post('/api/billing/pack').set(u.h).send({ packId: 'pack_150' }).expect(200);
      const p = create.mock.calls[0][0];
      expect(p.payment_method_options?.card?.request_three_d_secure).toBe('any');
      expect(p.payment_intent_data?.metadata).toMatchObject({ user_id: u.id, pack_id: 'pack_150' });
    } finally {
      (env.ctx.stripe!.checkout.sessions as unknown as { create: unknown }).create = original;
      (env.ctx.stripe!.customers as unknown as { create: unknown }).create = originalCustomer;
    }
  });

  it('una disputa (chargeback) bloquea la cuenta, retira los créditos y queda registrada', async () => {
    const u = await login(env);
    const pi = await buyPack(u.id);
    lines.length = 0;
    expect((await send('charge.dispute.created', {
      id: 'dp_1', object: 'dispute', amount: 300, currency: 'eur', reason: 'fraudulent', charge: 'ch_1',
      payment_intent: pi, evidence_details: {}, metadata: {},
    }).expect(200)).body.result).toBe('processed');
    expect(await credits(env, u.h)).toMatchObject({ available: 0 });
    const r = await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID()).send(textTask('x')).expect(403);
    expect(r.body.error.code).toBe('account_blocked');
    expect(lines.filter((l) => l['sec'] === 'payment_dispute')).toHaveLength(1);
  });

  it('un aviso temprano de fraude de Stripe (Radar) también bloquea', async () => {
    const u = await login(env);
    await env.ctx.db.query('update profiles set stripe_customer_id = $2 where id = $1', [u.id, `cus_w_${u.id.slice(0, 6)}`]);
    await buyPack(u.id);
    // sin payment_intent conocido: se identifica por el cliente de Stripe del cargo
    await send('radar.early_fraud_warning.created', {
      id: 'issfr_1', object: 'radar.early_fraud_warning', charge: { id: 'ch_2', customer: `cus_w_${u.id.slice(0, 6)}` },
      payment_intent: 'pi_desconocido', fraud_type: 'card_never_received',
    }).expect(200);
    await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID()).send(textTask('x')).expect(403);
  });

  it('un reembolso de un pack retira sus créditos (lo que quede)', async () => {
    const u = await login(env);
    const pi = await buyPack(u.id, 'pack_800', 1000);
    expect((await credits(env, u.h)).permanent).toBe(800);
    await send('charge.refunded', {
      id: 'ch_3', object: 'charge', amount: 1000, amount_refunded: 1000, refunded: true, currency: 'eur', payment_intent: pi, metadata: {},
    }).expect(200);
    expect(await credits(env, u.h)).toMatchObject({ permanent: 0 });
  });
});

describe('tope diario del motor de pago', () => {
  it('con GENERATION_DAILY_LIMIT, las tareas de más esperan en cola hasta el día siguiente y salta una alerta', async () => {
    await env.ctx.db.query(`update tasks set status = 'cancelled', finished_at = now() where status in ('queued','running')`);
    // el cupo de hoy deja sitio para exactamente una generación más
    const today = Number((await env.ctx.db.query(
      `select count(*) from tasks where started_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`)).rows[0].count);
    const ctx = { ...env.ctx, cfg: { ...env.cfg, GENERATION_DAILY_LIMIT: today + 1 } };
    const u = await login(env);
    await buyPack(u.id);
    const a = (await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID()).send(textTask('una silla')).expect(201)).body.task;
    lines.length = 0;
    expect(await dispatch(ctx)).toEqual([a.id]); // la primera entra
    await env.ctx.db.query(`update tasks set status = 'success', finished_at = now() where id = $1`, [a.id]);
    await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID()).send(textTask('una mesa')).expect(201);
    expect(await dispatch(ctx)).toEqual([]); // la segunda espera: tope alcanzado
    expect(await dispatch(ctx)).toEqual([]);
    expect(lines.filter((l) => l['sec'] === 'budget_reached')).toHaveLength(1); // un solo aviso, no uno por pasada
  });
});
