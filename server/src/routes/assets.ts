import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { tx } from '../db.js';
import { planOf } from '../lib/credits.js';
import { convert, CONTENT_TYPE, type Format } from '../lib/convert.js';
import { HttpError, uuid } from '../lib/http.js';
import * as ser from '../lib/serialize.js';
import { assertOwner } from './account.js';

export function assetRoutes(ctx: Ctx) {
  const r = Router();
  const { db, storage, cfg } = ctx;

  r.get('/', async (req, res) => {
    const q = z.object({
      q: z.string().max(100).optional(),
      series: z.enum(['hd', 'smart']).optional(),
      hasTexture: z.enum(['true', 'false']).optional(),
    }).parse(req.query);
    const args: unknown[] = [req.user!.id];
    let where = 'a.user_id = $1 and (a.expires_at is null or a.expires_at > now())';
    if (q.q?.trim()) { args.push(`%${q.q.trim().replace(/[%_\\]/g, '\\$&')}%`); where += ` and a.name ilike $${args.length}`; }
    if (q.series) { args.push(q.series); where += ` and a.series = $${args.length}`; }
    if (q.hasTexture) { args.push(q.hasTexture === 'true'); where += ` and a.has_texture = $${args.length}`; }
    res.json({ assets: await ser.assets(db, storage, where, args, false) });
  });

  r.get('/:id', async (req, res) => {
    const [asset] = await ser.assets(db, storage, 'a.id = $1 and a.user_id = $2', [uuid.parse(req.params.id), req.user!.id], true);
    if (!asset) throw new HttpError(404, 'not_found', 'Este modelo ya no existe');
    res.json({ asset });
  });

  r.patch('/:id', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const body = z.object({
      name: z.string().trim().min(1, 'El nombre no puede estar vacío').max(120).optional(),
      privacy: z.enum(['public', 'private']).optional(),
    }).parse(req.body);
    if (body.privacy === 'private' && !(await planOf(db, req.user!.id)).allow_private) {
      throw new HttpError(403, 'plan_feature', 'Los modelos privados están en los planes de pago');
    }
    const upd = await db.query(
      `update assets set name = coalesce($3, name), privacy = coalesce($4, privacy) where id = $1 and user_id = $2 returning id`,
      [id, req.user!.id, body.name ?? null, body.privacy ?? null],
    );
    assertOwner(upd);
    const [asset] = await ser.assets(db, storage, 'a.id = $1', [id], true);
    res.json({ asset });
  });

  r.delete('/:id', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const del = await db.query('delete from assets where id = $1 and user_id = $2 returning id', [id, req.user!.id]);
    assertOwner(del);
    await storage.removePrefix(`u/${req.user!.id}/assets/${id}/`);
    res.status(204).end();
  });

  /** Devuelve una URL firmada de descarga. Convierte el formato si aún no existe. Cuenta para el límite del plan. */
  r.post('/:id/export', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const { format } = z.object({ format: z.enum(['glb', 'obj', 'stl', 'usdz', 'fbx', '3mf']) }).parse(req.body);
    const userId = req.user!.id;
    const a = await db.query('select name from assets where id = $1 and user_id = $2', [id, userId]);
    assertOwner(a);
    const plan = await planOf(db, userId);
    // límite mensual: se comprueba y se apunta en la misma transacción para que dos pestañas no lo superen
    await tx(db, async (c) => {
      await c.query('select 1 from credit_accounts where user_id = $1 for update', [userId]);
      if (plan.monthly_export_limit !== null) {
        const used = Number((await c.query(
          `select count(*) from exports where user_id = $1 and created_at >= date_trunc('month', now())`, [userId])).rows[0].count);
        if (used >= plan.monthly_export_limit) {
          throw new HttpError(403, 'export_limit', `Has usado tus ${plan.monthly_export_limit} exportaciones de este mes`);
        }
      }
      await c.query('insert into exports (user_id, asset_id, format) values ($1,$2,$3)', [userId, id, format]);
    });
    const safe = (a.rows[0].name as string).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'modelo';
    const filename = `${safe}.${format}`;
    let key = (await db.query(
      `select storage_key from asset_files where asset_id = $1 and format = $2 and options_hash = 'default'`, [id, format])).rows[0]?.storage_key as string | undefined;
    if (!key) {
      const glbKey = (await db.query(`select storage_key from asset_files where asset_id = $1 and format = 'glb'`, [id])).rows[0]?.storage_key;
      if (!glbKey) throw new HttpError(409, 'not_ready', 'El modelo aún no está listo');
      let out: Buffer;
      try {
        out = await convert(await storage.read(glbKey), format as Format, cfg.BLENDER_PATH);
      } catch (e) {
        // si la conversión falla, la exportación no cuenta para el límite
        await db.query(`delete from exports where id = (select id from exports where user_id = $1 and asset_id = $2 order by created_at desc limit 1)`, [userId, id]);
        throw e;
      }
      key = `u/${userId}/assets/${id}/model.${format}`;
      await storage.write(key, out, CONTENT_TYPE[format as Format]);
      await db.query(
        `insert into asset_files (asset_id, format, storage_key, size_bytes) values ($1,$2,$3,$4) on conflict do nothing`,
        [id, format, key, out.length]);
    }
    // en la URL va un nombre genérico (sin datos del usuario); el bonito lo pone el navegador con `filename`
    res.json({ url: await storage.signedGet(key, `modelo-${id.slice(0, 8)}.${format}`, 600), filename });
  });

  return r;
}
