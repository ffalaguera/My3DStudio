import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { notifyTask, tx, type Tx } from '../db.js';
import { costOf, freeze, settle } from '../lib/credits.js';
import { HttpError, uuid } from '../lib/http.js';
import { sniffImage } from '../lib/image.js';
import { estimateSchema, evaluate, taskRequestSchema, type TaskRequest } from '../lib/rules.js';
import * as ser from '../lib/serialize.js';
import { ProviderError } from '../provider/provider.js';
import { assertOwner } from './account.js';
import { createProvider } from '../jobs/worker.js';

const idemKey = z.string().min(8).max(100);

/** Crea la tarea, sus entradas y congela los créditos, todo en una transacción. */
async function createTask(c: Tx, userId: string, req: TaskRequest, key: string,
  opts: { retryOf?: string; free?: boolean; shop?: { perDay: number } } = {}) {
  // idempotencia: el mismo envío devuelve la misma tarea (doble clic, reintento de red)
  const dup = await c.query('select id from tasks where user_id = $1 and idempotency_key = $2', [userId, key]);
  if (dup.rowCount) return dup.rows[0].id as string;

  // bloquear la cuenta primero serializa las peticiones simultáneas del mismo usuario
  await c.query('select 1 from credit_accounts where user_id = $1 for update', [userId]);
  if (req.uploadId) {
    const up = await c.query(`select status from uploads where id = $1 and user_id = $2`, [req.uploadId, userId]);
    if (!up.rowCount || up.rows[0].status !== 'ready') throw new HttpError(422, 'upload_required', 'Sube una imagen válida');
  }
  const blocked = await c.query('select blocked_at from profiles where id = $1', [userId]);
  if (blocked.rows[0]?.blocked_at) {
    throw new HttpError(403, 'account_blocked', 'Tu cuenta está bloqueada por una incidencia con un pago. Escríbenos para resolverlo');
  }
  let est: { credits: number };
  if (opts.shop) {
    // tienda: generar es gratis, con tope diario por persona (el gasto real lo paga la venta de la figura)
    if (opts.shop.perDay > 0) {
      const today = Number((await c.query(
        `select count(*) from tasks where user_id = $1 and status <> 'cancelled' and created_at >= date_trunc('day', now())`, [userId])).rows[0].count);
      if (today >= opts.shop.perDay) {
        throw new HttpError(429, 'generation_limit', `Ya has creado ${opts.shop.perDay} modelos hoy. Mañana puedes crear más`);
      }
    }
    // los modelos de la tienda son privados y de una sola variante; la textura no importa (la figura es de un color)
    req = { ...req, privacy: 'private', params: { ...req.params, variants: 1, textureResolution: '2k' } };
    est = { credits: 0 };
  } else {
    const e = await evaluate(c, userId, req, { free: opts.free });
    if (!e.allowed) throw new HttpError(e.reason === 'insufficient_credits' ? 402 : 403, e.reason!, e.detail!);
    est = e;
  }
  const params = { ...req.params, variants: req.series === 'smart' ? req.params.variants : 1 };
  const ins = await c.query(
    `insert into tasks (user_id, type, series, prompt, texture_prompt, params, privacy, idempotency_key, provider,
                        credits_cost, retry_of_task_id, is_free_retry)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11) returning id`,
    [userId, req.type, req.series, req.prompt ?? null, req.texturePrompt ?? null, params, req.privacy, key,
      est.credits, opts.retryOf ?? null, !!opts.free && !opts.shop],
  );
  const id = ins.rows[0].id as string;
  if (req.uploadId) await c.query(`insert into task_inputs (task_id, upload_id, view) values ($1,$2,'single')`, [id, req.uploadId]);
  await freeze(c, userId, id, est.credits);
  await notifyTask(c, userId, id);
  return id;
}

export function taskRoutes(ctx: Ctx) {
  const r = Router();
  const { db, storage } = ctx;
  const shop = ctx.cfg.BUSINESS_MODEL === 'shop' ? { perDay: ctx.cfg.GENERATION_FREE_PER_DAY } : undefined;

  r.post('/estimate', async (req, res) => {
    const body = estimateSchema.parse(req.body) as TaskRequest;
    if (shop) return res.json({ credits: 0, etaSeconds: body.series === 'hd' ? 180 : 30, allowed: true });
    const { plan, ...est } = await evaluate(db, req.user!.id, body);
    void plan;
    res.json(est);
  });

  r.post('/', async (req, res) => {
    const key = idemKey.parse(req.header('Idempotency-Key'));
    const body = taskRequestSchema.parse(req.body);
    const id = await tx(db, (c) => createTask(c, req.user!.id, body, key, { shop }));
    const [task] = await ser.tasks(db, storage, 't.id = $1 and t.user_id = $2', [id, req.user!.id]);
    res.status(201).json({ task });
  });

  /**
   * Vista previa antes de pagar: solo la imagen de referencia de un texto. No cobra créditos, pero exige saldo para un
   * modelo y tiene tope diario. Si se aprueba, el modelo se pide como image_to_model con esta subida (precio normal).
   */
  r.post('/preview', async (req, res) => {
    const { prompt } = z.object({ prompt: z.string().trim().min(1, 'Describe el objeto').max(1024) }).parse(req.body);
    const userId = req.user!.id;
    const id = randomUUID();
    const key = `u/${userId}/uploads/${id}.png`;
    await tx(db, async (c) => {
      await c.query('select 1 from credit_accounts where user_id = $1 for update', [userId]);
      const blocked = await c.query('select blocked_at from profiles where id = $1', [userId]);
      if (blocked.rows[0]?.blocked_at) {
        throw new HttpError(403, 'account_blocked', 'Tu cuenta está bloqueada por una incidencia con un pago. Escríbenos para resolverlo');
      }
      const need = shop ? 0 : costOf('hd', { texture: true, textureResolution: '2k', variants: 1 });
      const acc = (await c.query('select monthly_balance + permanent_balance as available from credit_accounts where user_id = $1', [userId])).rows[0];
      const available = Number(acc?.available ?? 0);
      if (available < need) {
        throw new HttpError(402, 'insufficient_credits', `Para ver la imagen necesitas saldo para un modelo (${need} créditos). Te faltan ${need - available}`);
      }
      const limit = ctx.cfg.PREVIEW_DAILY_LIMIT;
      if (limit > 0) {
        const used = Number((await c.query(
          `select count(*) from uploads where user_id = $1 and source = 'preview' and created_at >= date_trunc('day', now())`, [userId])).rows[0].count);
        if (used >= limit) throw new HttpError(429, 'preview_limit', `Has visto ${limit} imágenes hoy. Mañana puedes ver más`);
      }
      // la fila se crea antes de llamar al motor para que dos peticiones a la vez no pasen del tope
      await c.query(
        `insert into uploads (id, user_id, kind, storage_key, content_type, size_bytes, source, filename)
         values ($1,$2,'image',$3,'image/png',1,'preview','vista-previa.png')`, [id, userId, key]);
    });
    const ac = new AbortController();
    req.on('close', () => { if (!res.writableEnded) ac.abort(); });
    let img: { bytes: Buffer };
    try {
      img = await createProvider(ctx).referenceImage(prompt, ac.signal);
    } catch (e) {
      await db.query(`update uploads set status = 'rejected' where id = $1`, [id]);
      if (!(e instanceof ProviderError)) console.error('[preview] fallo', (e as Error).message);
      throw new HttpError(502, 'preview_failed', e instanceof ProviderError ? e.message : 'No se ha podido crear la imagen. Prueba otra vez');
    }
    const info = sniffImage(img.bytes);
    if (!info || info.type !== 'image/png') {
      await db.query(`update uploads set status = 'rejected' where id = $1`, [id]);
      throw new HttpError(502, 'preview_failed', 'No se ha podido crear la imagen');
    }
    await storage.write(key, img.bytes, 'image/png');
    await db.query(`update uploads set status = 'ready', width = $2, height = $3, size_bytes = $4 where id = $1`,
      [id, info.width, info.height, img.bytes.length]);
    res.status(201).json({
      upload: { id, previewUrl: await storage.signedGet(key), width: info.width, height: info.height, sizeBytes: img.bytes.length },
    });
  });

  r.get('/', async (req, res) => {
    const active = req.query['status'] === 'active';
    const list = await ser.tasks(db, storage, `t.user_id = $1${active ? ` and t.status in ('queued','running')` : ''}`, [req.user!.id]);
    res.json({ tasks: list });
  });

  r.get('/:id', async (req, res) => {
    const [task] = await ser.tasks(db, storage, 't.id = $1 and t.user_id = $2', [uuid.parse(req.params.id), req.user!.id]);
    if (!task) throw new HttpError(404, 'not_found', 'La tarea no existe');
    res.json({ task });
  });

  /** Cancela una tarea en cola y libera sus créditos. Las que ya están en curso no se pueden cancelar. */
  r.delete('/:id', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const userId = req.user!.id;
    await tx(db, async (c) => {
      const t = await c.query('select status from tasks where id = $1 and user_id = $2 for update', [id, userId]);
      assertOwner(t, 'La tarea no existe');
      if (t.rows[0].status !== 'queued') throw new HttpError(409, 'not_cancellable', 'Solo se pueden cancelar las tareas en cola');
      await c.query(`update tasks set status = 'cancelled', finished_at = now() where id = $1`, [id]);
      await settle(c, userId, id, 'release');
      await notifyTask(c, userId, id);
    });
    const [task] = await ser.tasks(db, storage, 't.id = $1', [id]);
    res.json({ task });
  });

  /** Repite una tarea con los mismos datos. Se paga como una generación nueva: cada intento es una llamada de pago al motor. */
  r.post('/:id/retry', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const key = idemKey.parse(req.header('Idempotency-Key'));
    const userId = req.user!.id;
    const newId = await tx(db, async (c) => {
      const t = await c.query(
        `select t.*, (select upload_id from task_inputs where task_id = t.id limit 1) as upload_id
         from tasks t where t.id = $1 and t.user_id = $2`, [id, userId]);
      assertOwner(t, 'La tarea no existe');
      const o = t.rows[0];
      const body = taskRequestSchema.parse({
        type: o.type, series: o.series, prompt: o.prompt ?? undefined, texturePrompt: o.texture_prompt ?? undefined,
        uploadId: o.upload_id ?? undefined, params: o.params, privacy: o.privacy,
      });
      return createTask(c, userId, body, key, { retryOf: id, free: false, shop });
    });
    const [task] = await ser.tasks(db, storage, 't.id = $1', [newId]);
    res.status(201).json({ task });
  });

  return r;
}
