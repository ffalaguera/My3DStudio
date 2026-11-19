import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { planOf, type PlanRow } from '../lib/credits.js';
import { signLocalToken } from '../lib/auth.js';
import { HttpError } from '../lib/http.js';
import * as ser from '../lib/serialize.js';

export function accountRoutes(ctx: Ctx, auth: ReturnType<typeof import('../lib/auth.js').requireUser>) {
  const r = Router();
  const { db } = ctx;

  /** Qué puede hacer este servidor según su configuración (formatos con o sin Blender, pagos activos). */
  r.get('/capabilities', (_req, res) => {
    res.json({
      exportFormats: ctx.cfg.BLENDER_PATH ? ['glb', 'obj', 'stl', '3mf', 'usdz', 'fbx'] : ['glb', 'obj', 'stl', '3mf'],
      billing: !!ctx.stripe,
      localAuth: ctx.cfg.LOCAL_AUTH,
    });
  });

  r.get('/plans', async (_req, res) => {
    const rows = await db.query<PlanRow>('select * from plans where is_public order by sort_order');
    res.json({ plans: rows.rows.map(ser.plan) });
  });

  // Solo desarrollo y tests: entra con cualquier email (crea el usuario en auth.users local).
  if (ctx.cfg.LOCAL_AUTH) {
    r.post('/dev/login', async (req, res) => {
      const { email } = z.object({ email: z.string().email().max(200) }).parse(req.body);
      const row = await db.query<{ id: string }>(
        `insert into auth.users (id, email) values ($1, lower($2))
         on conflict (email) do update set email = excluded.email returning id`,
        [randomUUID(), email],
      );
      const token = await signLocalToken(ctx.cfg, { id: row.rows[0].id, email: email.toLowerCase() });
      res.json({ token, user: { id: row.rows[0].id, email: email.toLowerCase() } });
    });
  }

  r.get('/me', auth, async (req, res) => {
    const u = req.user!;
    const [p, plan, acc, usage] = await Promise.all([
      db.query('select id, email, display_name from profiles where id = $1', [u.id]),
      planOf(db, u.id),
      db.query('select * from credit_accounts where user_id = $1', [u.id]),
      db.query(
        `select (select count(*) from exports where user_id = $1 and created_at >= date_trunc('month', now())) as exports,
                (select count(*) from assets where user_id = $1) as saved,
                (select count(*) from tasks where user_id = $1 and status in ('queued','running')) as active`,
        [u.id],
      ),
    ]);
    const a = acc.rows[0];
    res.json({
      profile: { id: u.id, email: p.rows[0].email, displayName: p.rows[0].display_name ?? u.email.split('@')[0] },
      plan: ser.plan(plan),
      credits: {
        monthly: a.monthly_balance, permanent: a.permanent_balance, frozen: a.frozen_monthly + a.frozen_permanent,
        available: a.monthly_balance + a.permanent_balance, cycleEndsAt: a.monthly_cycle_ends_at?.toISOString() ?? null,
      },
      usage: { exportsThisMonth: Number(usage.rows[0].exports), savedModels: Number(usage.rows[0].saved), activeTasks: Number(usage.rows[0].active) },
    });
  });

  r.get('/credits/ledger', auth, async (req, res) => {
    const rows = await db.query(
      `select id, delta, bucket, reason, coalesce(note, '') as note, created_at from credit_ledger
       where user_id = $1 order by created_at desc, id limit 100`,
      [req.user!.id],
    );
    res.json({ entries: rows.rows.map((e) => ({ ...e, createdAt: e.created_at.toISOString(), created_at: undefined })) });
  });

  /** Borrado real (RGPD y requisito de Apple): archivos, filas, suscripción y usuario de auth. */
  r.delete('/me', auth, async (req, res) => {
    const { confirm } = z.object({ confirm: z.literal('BORRAR') }).parse(req.body ?? {});
    void confirm;
    const u = req.user!;
    const p = await db.query<{ email: string | null; stripe_customer_id: string | null }>(
      'select email, stripe_customer_id from profiles where id = $1', [u.id]);
    if (ctx.stripe && p.rows[0]?.stripe_customer_id) {
      const subs = await ctx.stripe.subscriptions.list({ customer: p.rows[0].stripe_customer_id, status: 'active' });
      for (const s of subs.data) await ctx.stripe.subscriptions.cancel(s.id);
    }
    await ctx.storage.removePrefix(`u/${u.id}/`);
    await ctx.deleteAuthUser(u.id); // borra auth.users → cascada en profiles y todo lo suyo
    auth.forget(u.id);
    if (p.rows[0]?.email) await ctx.mailer.send(p.rows[0].email, { kind: 'account_deleted' }).catch(() => {});
    res.status(202).json({ ok: true });
  });

  return r;
}

export function assertOwner(found: { rowCount: number | null }, what = 'Este modelo ya no existe'): void {
  // 404 también cuando existe pero es de otro usuario: no revelar que existe.
  if (!found.rowCount) throw new HttpError(404, 'not_found', what);
}
