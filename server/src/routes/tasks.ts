import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { notifyTask, tx, type Tx } from '../db.js';
import { freeze, settle } from '../lib/credits.js';
import { HttpError, uuid } from '../lib/http.js';
import { estimateSchema, evaluate, taskRequestSchema, type TaskRequest } from '../lib/rules.js';
import * as ser from '../lib/serialize.js';
import { assertOwner } from './account.js';

const idemKey = z.string().min(8).max(100);

/** Crea la tarea, sus entradas y congela los créditos, todo en una transacción. */
async function createTask(c: Tx, userId: string, req: TaskRequest, key: string, opts: { retryOf?: string; free?: boolean } = {}) {
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
  const est = await evaluate(c, userId, req, { free: opts.free });
  if (!est.allowed) throw new HttpError(est.reason === 'insufficient_credits' ? 402 : 403, est.reason!, est.detail!);
  const params = { ...req.params, variants: req.series === 'smart' ? req.params.variants : 1 };
  const ins = await c.query(
    `insert into tasks (user_id, type, series, prompt, texture_prompt, params, privacy, idempotency_key, provider,
                        credits_cost, retry_of_task_id, is_free_retry)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11) returning id`,
    [userId, req.type, req.series, req.prompt ?? null, req.texturePrompt ?? null, params, req.privacy, key,
      est.credits, opts.retryOf ?? null, !!opts.free],
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

  r.post('/estimate', async (req, res) => {
    const body = estimateSchema.parse(req.body) as TaskRequest;
    const { plan, ...est } = await evaluate(db, req.user!.id, body);
    void plan;
    res.json(est);
  });

  r.post('/', async (req, res) => {
    const key = idemKey.parse(req.header('Idempotency-Key'));
    const body = taskRequestSchema.parse(req.body);
    const id = await tx(db, (c) => createTask(c, req.user!.id, body, key));
    const [task] = await ser.tasks(db, storage, 't.id = $1 and t.user_id = $2', [id, req.user!.id]);
    res.status(201).json({ task });
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
      return createTask(c, userId, body, key, { retryOf: id, free: false });
    });
    const [task] = await ser.tasks(db, storage, 't.id = $1', [newId]);
    res.status(201).json({ task });
  });

  return r;
}
