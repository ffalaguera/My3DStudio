import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { login, makeEnv, PARAMS, WEBHOOK_SECRET, type Env } from './helpers.js';

// Tienda (BUSINESS_MODEL=shop): generar gratis con tope, comprar la figura impresa, nunca descargar el archivo.
let env: Env;
const signer = new Stripe('sk_test_solo_para_firmas');
const created: Stripe.Checkout.SessionCreateParams[] = [];

beforeAll(async () => {
  env = await makeEnv({ env: { BUSINESS_MODEL: 'shop', GENERATION_FREE_PER_DAY: '2', ADMIN_EMAILS: 'taller@example.com' } });
  // Stripe no se llama de verdad: se guarda lo que se le pediría
  (env.ctx.stripe!.checkout.sessions as unknown as { create: unknown }).create = async (p: Stripe.Checkout.SessionCreateParams) => {
    created.push(p);
    return { id: `cs_test_${created.length}`, url: `https://checkout.stripe.test/${created.length}` };
  };
});
afterAll(async () => {
  await env.app.closeEvents();
  await env.ctx.db.end();
});

const drain = async () => {
  const { dispatch, runGeneration, createProvider } = await import('../src/jobs/worker.js');
  const provider = createProvider(env.ctx);
  for (const id of await dispatch(env.ctx)) await runGeneration(env.ctx, provider, id);
};

async function model(u: { h: { Authorization: string } }, prompt = 'un búho'): Promise<string> {
  const t = (await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID())
    .send({ type: 'text_to_model', series: 'hd', prompt, privacy: 'public', params: PARAMS }).expect(201)).body.task;
  await drain();
  return (await env.api().get(`/api/tasks/${t.id}`).set(u.h)).body.task.assetIds[0];
}

let seq = 0;
function webhook(type: string, object: object) {
  const payload = JSON.stringify({ id: `evt_shop_${Date.now()}_${++seq}`, object: 'event', type, data: { object }, api_version: '2024-12-18.acacia', created: 0, livemode: false });
  const sig = signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return env.api().post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', sig).send(payload);
}

describe('tienda: generar', () => {
  it('generar es gratis, el modelo es privado y hay tope diario', async () => {
    const u = await login(env);
    await env.ctx.db.query('update credit_accounts set monthly_balance = 0, permanent_balance = 0 where user_id = $1', [u.id]);
    const est = (await env.api().post('/api/tasks/estimate').set(u.h).send({ type: 'text_to_model', series: 'hd', params: PARAMS })).body;
    expect(est).toMatchObject({ credits: 0, allowed: true });
    const a = await model(u);
    expect((await env.api().get(`/api/assets/${a}`).set(u.h)).body.asset.privacy).toBe('private');
    await model(u, 'una taza');
    const r = await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID())
      .send({ type: 'text_to_model', series: 'hd', prompt: 'una silla', params: PARAMS }).expect(429);
    expect(r.body.error.code).toBe('generation_limit');
    const me = (await env.api().get('/api/me').set(u.h)).body;
    expect(me.generations).toEqual({ perDay: 2, today: 2 });
    expect(me.isAdmin).toBe(false);
  });

  it('la vista previa de imagen no pide saldo en la tienda', async () => {
    const u = await login(env);
    await env.ctx.db.query('update credit_accounts set monthly_balance = 0, permanent_balance = 0 where user_id = $1', [u.id]);
    await env.api().post('/api/tasks/preview').set(u.h).send({ prompt: 'un gato' }).expect(201);
  });

  it('los modelos no se descargan', async () => {
    const u = await login(env);
    const a = await model(u);
    const r = await env.api().post(`/api/assets/${a}/export`).set(u.h).send({ format: 'stl' }).expect(403);
    expect(r.body.error.code).toBe('no_downloads');
  });
});

describe('tienda: comprar la figura', () => {
  it('catálogo público con tamaños, colores y envío', async () => {
    const c = (await env.api().get('/api/shop/catalog').expect(200)).body;
    expect(c.sizes.map((s: { id: string }) => s.id)).toEqual(['s', 'm', 'l']);
    expect(c.colors.length).toBeGreaterThan(2);
    expect(c.shippingCents).toBeGreaterThan(0);
  });

  it('pedido → Stripe Checkout con dirección de envío → webhook pagado → aparece en Mis pedidos', async () => {
    const u = await login(env);
    const a = await model(u);
    const r = (await env.api().post('/api/orders').set(u.h).send({ assetId: a, size: 'm', color: 'rojo', base: true, quantity: 2 }).expect(201)).body;
    expect(r.url).toMatch(/^https:\/\/checkout\.stripe\.test/);
    expect(r.order).toMatchObject({ status: 'pending_payment', heightMm: 120, unitCents: 3490, totalCents: 3490 * 2 + 490 });
    const p = created.at(-1)!;
    expect(p.shipping_address_collection?.allowed_countries).toEqual(['ES']);
    expect(p.line_items![0]).toMatchObject({ quantity: 2, price_data: { unit_amount: 3490, currency: 'eur' } });
    expect(p.metadata).toMatchObject({ order_id: r.order.id });
    // sin pagar no aparece en Mis pedidos
    expect((await env.api().get('/api/orders').set(u.h)).body.orders).toEqual([]);

    // un importe distinto no marca el pedido como pagado
    await webhook('checkout.session.completed', { id: 'cs_x', object: 'checkout.session', mode: 'payment', payment_status: 'paid',
      amount_total: 100, currency: 'eur', metadata: { order_id: r.order.id }, payment_intent: 'pi_malo' }).expect(200);
    expect((await env.api().get(`/api/orders/${r.order.id}`).set(u.h)).body.order.status).toBe('pending_payment');

    const shipping = { name: 'Ana Pérez', address: { line1: 'Calle Mayor 1', city: 'Madrid', postal_code: '28013', country: 'ES' } };
    await webhook('checkout.session.completed', { id: 'cs_ok', object: 'checkout.session', mode: 'payment', payment_status: 'paid',
      amount_total: 3490 * 2 + 490, currency: 'eur', metadata: { order_id: r.order.id }, payment_intent: `pi_${r.order.id.slice(0, 8)}`,
      customer_details: { email: u.email, phone: '+34600000000' }, collected_information: { shipping_details: shipping } }).expect(200);
    const mine = (await env.api().get('/api/orders').set(u.h)).body.orders;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: 'paid', shipping: { name: 'Ana Pérez' }, color: 'rojo', base: true });

    // el modelo del historial puede borrarse: el pedido conserva su copia
    await env.api().delete(`/api/assets/${a}`).set(u.h);
    const admin = await login(env, 'taller');
    await env.ctx.db.query(`update profiles set email = 'taller@example.com' where id = $1`, [admin.id]);
    const file = (await env.api().post(`/api/admin/orders/${r.order.id}/file`).set(admin.h).send({ format: 'stl' }).expect(200)).body;
    expect(file.print).toMatchObject({ heightMm: 120, base: true });
    expect(file.filename).toContain('rojo-120mm.stl');
  });

  it('no se puede pedir el modelo de otra persona ni un tamaño que no existe', async () => {
    const owner = await login(env);
    const a = await model(owner);
    const other = await login(env);
    await env.api().post('/api/orders').set(other.h).send({ assetId: a, size: 'm', color: 'rojo' }).expect(404);
    await env.api().post('/api/orders').set(owner.h).send({ assetId: a, size: 'xl', color: 'rojo' }).expect(422);
    await env.api().post('/api/orders').set(owner.h).send({ assetId: a, size: 'm', color: 'dorado' }).expect(422);
  });

  it('reembolso desde Stripe marca el pedido como reembolsado', async () => {
    const u = await login(env);
    const a = await model(u);
    const o = (await env.api().post('/api/orders').set(u.h).send({ assetId: a, size: 's', color: 'gris' }).expect(201)).body.order;
    await webhook('checkout.session.completed', { id: 'cs_r', object: 'checkout.session', mode: 'payment', payment_status: 'paid',
      amount_total: o.totalCents, currency: 'eur', metadata: { order_id: o.id }, payment_intent: `pi_r_${o.id.slice(0, 8)}` }).expect(200);
    await webhook('charge.refunded', { id: 'ch_r', object: 'charge', payment_intent: `pi_r_${o.id.slice(0, 8)}`, customer: null }).expect(200);
    expect((await env.api().get(`/api/orders/${o.id}`).set(u.h)).body.order.status).toBe('refunded');
  });
});

describe('panel del taller', () => {
  it('solo para ADMIN_EMAILS; cola de pedidos y cambios de estado válidos', async () => {
    const u = await login(env);
    await env.api().get('/api/admin/orders').set(u.h).expect(404);
    const admin = await login(env, 'taller');
    await env.ctx.db.query(`update profiles set email = 'taller@example.com' where id = $1`, [admin.id]);
    // isAdmin mira el email del perfil
    expect((await env.api().get('/api/me').set(admin.h)).body.isAdmin).toBe(true);

    const a = await model(u);
    const o = (await env.api().post('/api/orders').set(u.h).send({ assetId: a, size: 'l', color: 'azul' }).expect(201)).body.order;
    await env.api().post(`/api/admin/orders/${o.id}/file`).set(admin.h).send({}).expect(409); // sin pagar
    await webhook('checkout.session.completed', { id: 'cs_a', object: 'checkout.session', mode: 'payment', payment_status: 'paid',
      amount_total: o.totalCents, currency: 'eur', metadata: { order_id: o.id }, payment_intent: `pi_a_${o.id.slice(0, 8)}` }).expect(200);
    const queue = (await env.api().get('/api/admin/orders').set(admin.h).expect(200)).body.orders;
    expect(queue.map((x: { id: string }) => x.id)).toContain(o.id);
    await env.api().patch(`/api/admin/orders/${o.id}`).set(admin.h).send({ status: 'shipped' }).expect(409); // primero se imprime
    await env.api().patch(`/api/admin/orders/${o.id}`).set(admin.h).send({ status: 'printing' }).expect(200);
    const shipped = (await env.api().patch(`/api/admin/orders/${o.id}`).set(admin.h).send({ status: 'shipped', tracking: 'ES123' }).expect(200)).body.order;
    expect(shipped).toMatchObject({ status: 'shipped', tracking: 'ES123' });
    expect((await env.api().get(`/api/orders/${o.id}`).set(u.h)).body.order).toMatchObject({ status: 'shipped', tracking: 'ES123' });
  });
});
