import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { tx } from '../db.js';
import { convertForPrint } from '../lib/convert.js';
import { HttpError, uuid } from '../lib/http.js';
import { catalog, COLORS, MAX_QUANTITY, priceOf, SHIPPING_COUNTRIES, SIZES, type SizeId } from '../lib/shop.js';
import { assertOwner } from './account.js';

export interface OrderRow {
  id: string; user_id: string | null; asset_id: string | null; asset_name: string; model_key: string;
  size: SizeId; height_mm: number; color: string; base: boolean; quantity: number;
  unit_cents: number; shipping_cents: number; total_cents: number; currency: string; status: string;
  email: string | null; shipping: unknown; tracking: string | null; note: string | null;
  created_at: Date; paid_at: Date | null; shipped_at: Date | null;
}

/** Lo que ve el cliente de su pedido (sin la ruta del modelo ni notas internas). */
export function serializeOrder(o: OrderRow, admin = false) {
  return {
    id: o.id, assetId: o.asset_id, assetName: o.asset_name, size: o.size, heightMm: o.height_mm, color: o.color, base: o.base,
    quantity: o.quantity, unitCents: o.unit_cents, shippingCents: o.shipping_cents, totalCents: o.total_cents, currency: o.currency,
    status: o.status, tracking: o.tracking, shipping: o.shipping ?? null,
    createdAt: o.created_at.toISOString(), paidAt: o.paid_at?.toISOString() ?? null, shippedAt: o.shipped_at?.toISOString() ?? null,
    ...(admin ? { email: o.email, note: o.note, userId: o.user_id } : {}),
  };
}

/** Pago de demostración: solo sin Stripe y fuera de producción (desarrollo y e2e). */
const demoPayments = (ctx: Ctx) => !ctx.stripe && ctx.cfg.NODE_ENV !== 'production';

export function shopRoutes(ctx: Ctx) {
  const r = Router();
  r.get('/catalog', (_req, res) => res.json({ ...catalog(), demoPayments: demoPayments(ctx) }));
  return r;
}

export function orderRoutes(ctx: Ctx) {
  const r = Router();
  const { db, storage } = ctx;

  /** Crea el pedido de una figura y devuelve la página de pago (Stripe Checkout, o la de demostración en local). */
  r.post('/', async (req, res) => {
    const body = z.object({
      assetId: uuid,
      size: z.enum(SIZES.map((s) => s.id) as [SizeId, ...SizeId[]]),
      color: z.enum(COLORS.map((c) => c.id) as [string, ...string[]]),
      base: z.boolean().default(false),
      quantity: z.number().int().min(1).max(MAX_QUANTITY).default(1),
    }).parse(req.body);
    const userId = req.user!.id;
    const blocked = await db.query('select blocked_at from profiles where id = $1', [userId]);
    if (blocked.rows[0]?.blocked_at) {
      throw new HttpError(403, 'account_blocked', 'Tu cuenta está bloqueada por una incidencia con un pago. Escríbenos para resolverlo');
    }
    const a = await db.query(
      `select a.name, f.storage_key from assets a
         left join asset_files f on f.asset_id = a.id and f.format = 'glb' and f.options_hash = 'default'
        where a.id = $1 and a.user_id = $2 and a.kind = 'model'`, [body.assetId, userId]);
    assertOwner(a, 'El modelo no existe');
    if (!a.rows[0].storage_key) throw new HttpError(409, 'not_ready', 'El modelo aún no está listo');
    const price = priceOf(body.size, body.quantity);
    const order = (await db.query<OrderRow>(
      `insert into print_orders (user_id, asset_id, asset_name, model_key, size, height_mm, color, base, quantity,
                                 unit_cents, shipping_cents, total_cents, email)
       values ($1,$2,$3,'pendiente',$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [userId, body.assetId, a.rows[0].name, body.size, price.heightMm, body.color, body.base, body.quantity,
        price.unitCents, price.shippingCents, price.totalCents, req.user!.email])).rows[0];
    // copia propia del modelo: el del historial puede caducar o borrarse antes de imprimir
    const modelKey = `orders/${order.id}/model.glb`;
    await storage.write(modelKey, await storage.read(a.rows[0].storage_key), 'model/gltf-binary');
    await db.query('update print_orders set model_key = $2 where id = $1', [order.id, modelKey]);

    const size = SIZES.find((s) => s.id === body.size)!;
    const color = COLORS.find((c) => c.id === body.color)!;
    if (!ctx.stripe) {
      if (!demoPayments(ctx)) throw new HttpError(503, 'billing_disabled', 'Los pagos aún no están configurados');
      return res.status(201).json({ order: serializeOrder({ ...order, model_key: modelKey }), url: `${ctx.cfg.APP_URL}/pedidos/${order.id}?pago=demo` });
    }
    const session = await ctx.stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: req.user!.email,
      client_reference_id: userId,
      line_items: [{
        quantity: body.quantity,
        price_data: {
          currency: 'eur', unit_amount: price.unitCents,
          product_data: {
            name: `Figura impresa en 3D: ${a.rows[0].name}`.slice(0, 250),
            description: `${size.name}, ${size.heightMm} mm de alto · ${color.name}${body.base ? ' · con peana' : ''}`,
          },
        },
      }],
      shipping_address_collection: { allowed_countries: [...SHIPPING_COUNTRIES] },
      shipping_options: [{
        shipping_rate_data: {
          type: 'fixed_amount', display_name: 'Envío a domicilio',
          fixed_amount: { amount: price.shippingCents, currency: 'eur' },
        },
      }],
      phone_number_collection: { enabled: true },
      metadata: { order_id: order.id, user_id: userId },
      payment_intent_data: { metadata: { order_id: order.id, user_id: userId } },
      payment_method_options: { card: { request_three_d_secure: 'any' } },
      success_url: `${ctx.cfg.APP_URL}/pedidos/${order.id}?pago=ok`,
      cancel_url: `${ctx.cfg.APP_URL}/crear?modelo=${body.assetId}`,
      automatic_tax: { enabled: false },
    }, { idempotencyKey: `order-${order.id}` });
    await db.query('update print_orders set stripe_session_id = $2 where id = $1', [order.id, session.id]);
    res.status(201).json({ order: serializeOrder({ ...order, model_key: modelKey }), url: session.url });
  });

  r.get('/', async (req, res) => {
    const rows = await db.query<OrderRow>(
      `select * from print_orders where user_id = $1 and status <> 'pending_payment' order by created_at desc limit 100`, [req.user!.id]);
    res.json({ orders: rows.rows.map((o) => serializeOrder(o)) });
  });

  r.get('/:id', async (req, res) => {
    const o = await db.query<OrderRow>('select * from print_orders where id = $1 and user_id = $2', [uuid.parse(req.params.id), req.user!.id]);
    assertOwner(o, 'El pedido no existe');
    res.json({ order: serializeOrder(o.rows[0]) });
  });

  /** Solo en desarrollo sin Stripe: simula el pago con una dirección de prueba. */
  r.post('/:id/demo-pay', async (req, res) => {
    if (!demoPayments(ctx)) throw new HttpError(404, 'not_found', 'Ruta no encontrada');
    const id = uuid.parse(req.params.id);
    const o = await db.query<OrderRow>(
      `update print_orders set status = 'paid', paid_at = now(), updated_at = now(),
              shipping = '{"name":"Cliente de prueba","address":{"line1":"Calle de la Demo 1","city":"Madrid","postal_code":"28001","country":"ES"}}'
        where id = $1 and user_id = $2 and status = 'pending_payment' returning *`, [id, req.user!.id]);
    if (!o.rowCount) {
      const again = await db.query<OrderRow>('select * from print_orders where id = $1 and user_id = $2', [id, req.user!.id]);
      assertOwner(again, 'El pedido no existe');
      return res.json({ order: serializeOrder(again.rows[0]) });
    }
    res.json({ order: serializeOrder(o.rows[0]) });
  });

  return r;
}

/** Panel del taller: solo emails en ADMIN_EMAILS. Cola de pedidos, cambio de estado y archivo listo para imprimir. */
export function adminRoutes(ctx: Ctx) {
  const r = Router();
  const { db, storage } = ctx;
  // el email del perfil (el mismo que decide isAdmin en /me); fuera de la lista la ruta "no existe"
  r.use((req, _res, next) => {
    db.query('select email from profiles where id = $1', [req.user!.id]).then((p) => {
      next(isAdmin(ctx, p.rows[0]?.email) ? undefined : new HttpError(404, 'not_found', 'Ruta no encontrada'));
    }, next);
  });

  r.get('/orders', async (req, res) => {
    const status = z.enum(['open', 'all', 'paid', 'printing', 'shipped', 'cancelled', 'refunded']).default('open').parse(req.query['status']);
    const where = status === 'open' ? `status in ('paid','printing')` : status === 'all' ? `status <> 'pending_payment'` : `status = '${status}'`;
    const rows = await db.query<OrderRow>(`select * from print_orders where ${where} order by coalesce(paid_at, created_at) asc limit 500`);
    res.json({ orders: rows.rows.map((o) => serializeOrder(o, true)) });
  });

  r.patch('/orders/:id', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const body = z.object({
      status: z.enum(['printing', 'shipped', 'cancelled']).optional(),
      tracking: z.string().trim().max(200).optional(),
      note: z.string().trim().max(2000).optional(),
    }).parse(req.body);
    const o = await tx(db, async (c) => {
      const cur = await c.query<OrderRow>('select * from print_orders where id = $1 for update', [id]);
      if (!cur.rowCount) throw new HttpError(404, 'not_found', 'El pedido no existe');
      const from = cur.rows[0].status;
      const allowed: Record<string, string[]> = { paid: ['printing', 'cancelled'], printing: ['shipped', 'cancelled'], shipped: [], cancelled: [] };
      if (body.status && body.status !== from && !(allowed[from] ?? []).includes(body.status)) {
        throw new HttpError(409, 'bad_transition', `Un pedido en estado ${from} no puede pasar a ${body.status}`);
      }
      return (await c.query<OrderRow>(
        `update print_orders set status = coalesce($2, status), tracking = coalesce($3, tracking), note = coalesce($4, note),
                shipped_at = case when $2 = 'shipped' then now() else shipped_at end, updated_at = now()
          where id = $1 returning *`, [id, body.status ?? null, body.tracking ?? null, body.note ?? null])).rows[0];
    });
    res.json({ order: serializeOrder(o, true) });
  });

  /** STL o 3MF a la altura del pedido, de pie y con peana si la lleva. Con su informe de malla. */
  r.post('/orders/:id/file', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const { format } = z.object({ format: z.enum(['stl', '3mf']).default('3mf') }).parse(req.body ?? {});
    const o = (await db.query<OrderRow>('select * from print_orders where id = $1', [id])).rows[0];
    if (!o) throw new HttpError(404, 'not_found', 'El pedido no existe');
    if (o.status === 'pending_payment') throw new HttpError(409, 'not_paid', 'Este pedido aún no está pagado');
    const { bytes, report } = await convertForPrint(await storage.read(o.model_key), format, { heightMm: o.height_mm, base: o.base });
    const key = `orders/${o.id}/print-${o.height_mm}${o.base ? '-peana' : ''}.${format}`;
    await storage.write(key, bytes, format === 'stl' ? 'model/stl' : 'model/3mf');
    const name = `pedido-${o.id.slice(0, 8)}-${o.color}-${o.height_mm}mm.${format}`;
    res.json({ url: await storage.signedGet(key, name, 600), filename: name, print: report });
  });

  return r;
}

export function isAdmin(ctx: Ctx, email: string | undefined | null): boolean {
  if (!email) return false;
  return ctx.cfg.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}
