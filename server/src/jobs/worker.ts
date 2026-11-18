import PgBoss from 'pg-boss';
import { randomUUID } from 'node:crypto';
import type { Ctx } from '../context.js';
import { notifyTask, tx } from '../db.js';
import { renewMonthly, settle } from '../lib/credits.js';
import { stats } from '../lib/convert.js';
import { FakeProvider } from '../provider/fake.js';
import { FalProvider } from '../provider/fal.js';
import { ModalProvider } from '../provider/modal.js';
import { ProviderError, type GenerationProvider } from '../provider/provider.js';

export function createProvider(ctx: Ctx): GenerationProvider {
  switch (ctx.cfg.GENERATION_PROVIDER) {
    case 'fake':
      return new FakeProvider(ctx.cfg.NODE_ENV === 'test' ? 20 : 400);
    case 'fal':
      return new FalProvider({ key: ctx.cfg.FAL_KEY!, baseUrl: ctx.cfg.FAL_BASE_URL });
    case 'modal':
      return new ModalProvider({ url: ctx.cfg.MODAL_TRELLIS_URL!, token: ctx.cfg.MODAL_SERVICE_TOKEN! });
  }
}

/**
 * Pasa tareas de `queued` a `running` respetando:
 *  - el límite de tareas a la vez de cada plan (1 / 10 / 100),
 *  - el tope global del proveedor (PROVIDER_MAX_CONCURRENCY), con prioridad para los planes de pago.
 * `for update skip locked` permite varios trabajadores sin pisarse.
 */
export async function dispatch(ctx: Ctx): Promise<string[]> {
  return tx(ctx.db, async (c) => {
    const running = Number((await c.query(`select count(*) from tasks where status = 'running'`)).rows[0].count);
    const room = ctx.cfg.PROVIDER_MAX_CONCURRENCY - running;
    if (room <= 0) return [];
    const r = await c.query<{ id: string; user_id: string }>(
      `with candidates as (
         select t.id, t.user_id, t.created_at, p.max_concurrent_tasks, p.price_month_cents > 0 as paid,
                row_number() over (partition by t.user_id order by t.created_at) as n,
                (select count(*) from tasks r where r.user_id = t.user_id and r.status = 'running') as busy
           from tasks t join profiles u on u.id = t.user_id join plans p on p.id = u.plan_id
          where t.status = 'queued')
       select id, user_id from candidates where busy + n <= max_concurrent_tasks
       order by paid desc, created_at limit $1`,
      [room],
    );
    if (!r.rowCount) return [];
    const ids = r.rows.map((x) => x.id);
    // bloquear y marcar; si otro trabajador ya las cogió, skip locked las salta
    const locked = await c.query<{ id: string; user_id: string }>(
      `update tasks set status = 'running', started_at = now(), provider = $2
        where id in (select id from tasks where id = any($1) and status = 'queued' for update skip locked)
        returning id, user_id`,
      [ids, ctx.cfg.GENERATION_PROVIDER],
    );
    for (const t of locked.rows) await notifyTask(c, t.user_id, t.id);
    return locked.rows.map((t) => t.id);
  });
}

/** Trabajo `generate` + `postprocess`: llama al motor, guarda GLB y estadísticas, crea los assets y cobra. */
export async function runGeneration(ctx: Ctx, provider: GenerationProvider, taskId: string): Promise<void> {
  const t = (await ctx.db.query(
    `select t.*, u.storage_key as input_key, u.content_type as input_type, u.filename as input_name
       from tasks t left join task_inputs i on i.task_id = t.id left join uploads u on u.id = i.upload_id
      where t.id = $1`, [taskId])).rows[0];
  if (!t || t.status !== 'running') return;
  const ac = new AbortController();
  let last = -1;
  const onProgress = async (pct: number) => {
    if (pct === last) return;
    last = pct;
    const upd = await ctx.db.query(`update tasks set progress = $2 where id = $1 and status = 'running' returning id`, [taskId, pct]);
    if (!upd.rowCount) ac.abort(); // la marcó como fallida reap-stuck
    else await notifyTask(ctx.db, t.user_id, taskId);
  };
  try {
    const image = t.input_key ? { bytes: await ctx.storage.read(t.input_key), contentType: t.input_type, filename: t.input_name ?? undefined } : undefined;
    const out = await provider.generate({
      taskId, type: t.type, series: t.series, prompt: t.prompt ?? undefined, texturePrompt: t.texture_prompt ?? undefined,
      image, params: t.params,
    }, onProgress, ac.signal);

    // postprocess: copiar todo a nuestro almacén (las URLs del proveedor caducan) y medir
    const plan = (await ctx.db.query(`select p.* from plans p join profiles u on u.plan_id = p.id where u.id = $1`, [t.user_id])).rows[0];
    const created: { id: string; key: string; size: number; faces: number; vertices: number; i: number }[] = [];
    for (const [i, glb] of out.variants.entries()) {
      const id = randomUUID();
      const key = `u/${t.user_id}/assets/${id}/model.glb`;
      await ctx.storage.write(key, glb, 'model/gltf-binary');
      const s = await stats(glb);
      created.push({ id, key, size: glb.length, faces: s.faces, vertices: s.vertices, i });
    }
    const base = (t.prompt ?? t.input_name ?? 'Modelo').replace(/\.[^.]+$/, '').slice(0, 60) || 'Modelo';
    await tx(ctx.db, async (c) => {
      const still = await c.query(`select status from tasks where id = $1 for update`, [taskId]);
      if (still.rows[0]?.status !== 'running') return; // la cancelaron o la marcaron como atascada
      for (const a of created) {
        const name = created.length > 1 ? `${base} (${a.i + 1})` : base;
        const slug = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'modelo';
        await c.query(
          `insert into assets (id, user_id, task_id, variant_index, kind, source, name, slug, prompt, series, model_version,
                               thumbnail_key, face_count, vertex_count, topology, texture_resolution, has_texture, has_pbr,
                               privacy, license, expires_at)
           values ($1,$2,$3,$4,'model','generated',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                   case when $19::int is null then null else now() + make_interval(days => $19::int) end)`,
          [a.id, t.user_id, taskId, a.i, name, slug, t.prompt, t.series, out.modelVersion,
            null, a.faces, a.vertices, t.series === 'smart' ? t.params.topology : 'tri',
            t.params.texture ? t.params.textureResolution : null, !!t.params.texture, !!(t.params.texture && t.params.pbr),
            t.privacy, plan.allow_commercial ? 'commercial' : 'attribution', plan.history_days],
        );
        await c.query(`insert into asset_files (asset_id, format, storage_key, size_bytes) values ($1,'glb',$2,$3)`, [a.id, a.key, a.size]);
      }
      // miniatura: la imagen de entrada mientras no haya render en el trabajador (Blender)
      if (t.input_key) await c.query(`update assets set thumbnail_key = $2 where task_id = $1`, [taskId, t.input_key]);
      await c.query(`update tasks set status = 'success', progress = 100, finished_at = now(), model_version = $2 where id = $1`,
        [taskId, out.modelVersion]);
      await settle(c, t.user_id, taskId, 'consume');
      await notifyTask(c, t.user_id, taskId);
    });
  } catch (e) {
    const message = e instanceof ProviderError ? e.message : 'Ha fallado la generación. Te hemos devuelto los créditos';
    if (!(e instanceof ProviderError)) console.error('[worker] fallo en la tarea', taskId.slice(0, 8), (e as Error).message);
    await failTask(ctx, taskId, message);
  }
}

export async function failTask(ctx: Ctx, taskId: string, message: string): Promise<void> {
  await tx(ctx.db, async (c) => {
    const t = await c.query(`select user_id, status from tasks where id = $1 for update`, [taskId]);
    if (!t.rowCount || !['queued', 'running'].includes(t.rows[0].status)) return;
    await c.query(`update tasks set status = 'failed', finished_at = now(), error_message = $2 where id = $1`, [taskId, message]);
    await settle(c, t.rows[0].user_id, taskId, 'release');
    await notifyTask(c, t.rows[0].user_id, taskId);
  });
}

// ------------------------------------------------------------------ trabajos programados

/** Día 1 de cada mes (UTC): renueva la bolsa mensual de los usuarios gratuitos. Los de pago, con invoice.paid. */
export async function grantFreeCredits(ctx: Ctx): Promise<number> {
  const users = await ctx.db.query<{ id: string }>(
    `select u.id from profiles u join credit_accounts a on a.user_id = u.id
      where u.plan_id = 'free' and (a.monthly_cycle_ends_at is null or a.monthly_cycle_ends_at <= now())`);
  const free = (await ctx.db.query(`select monthly_credits from plans where id = 'free'`)).rows[0].monthly_credits;
  const next = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));
  for (const u of users.rows) await tx(ctx.db, (c) => renewMonthly(c, u.id, free, next, 'Créditos del mes'));
  return users.rowCount ?? 0;
}

/** Borra los modelos cuyo historial ha caducado según el plan, y sus archivos. */
export async function expireHistory(ctx: Ctx): Promise<number> {
  const gone = await ctx.db.query<{ id: string; user_id: string }>(
    `delete from assets where expires_at is not null and expires_at < now() returning id, user_id`);
  for (const a of gone.rows) await ctx.storage.removePrefix(`u/${a.user_id}/assets/${a.id}/`);
  return gone.rowCount ?? 0;
}

/** Tareas en curso desde hace más de 30 min: fallidas y créditos devueltos. */
export async function reapStuck(ctx: Ctx): Promise<number> {
  const stuck = await ctx.db.query<{ id: string }>(`select id from tasks where status = 'running' and started_at < now() - interval '30 minutes'`);
  for (const t of stuck.rows) await failTask(ctx, t.id, 'La generación ha tardado demasiado. Te hemos devuelto los créditos');
  return stuck.rowCount ?? 0;
}

/** Subidas que nunca se completaron o no se usaron, de más de 24 h. */
export async function cleanupUploads(ctx: Ctx): Promise<number> {
  const old = await ctx.db.query<{ id: string; storage_key: string }>(
    `delete from uploads u where created_at < now() - interval '24 hours'
       and (status <> 'ready' or not exists (select 1 from task_inputs i where i.upload_id = u.id))
       and not exists (select 1 from assets a where a.thumbnail_key = u.storage_key)
     returning id, storage_key`);
  for (const u of old.rows) await ctx.storage.removePrefix(u.storage_key).catch(() => {});
  return old.rowCount ?? 0;
}

export async function startWorker(ctx: Ctx): Promise<{ stop: () => Promise<void> }> {
  const provider = createProvider(ctx);
  const boss = new PgBoss({ connectionString: ctx.cfg.DATABASE_URL, schema: 'pgboss' });
  boss.on('error', (e) => console.error('[worker] pg-boss:', e.message));
  await boss.start();
  // dead-letter primero: las demás colas apuntan a ella
  const queues = ['dead-letter', 'generate', 'grant-free-credits', 'expire-history', 'reap-stuck', 'cleanup-uploads'];
  for (const q of queues) {
    await boss.createQueue(q, q === 'dead-letter' ? { name: q } : { name: q, retryLimit: 2, retryBackoff: true, deadLetter: 'dead-letter' });
  }

  await boss.work<{ taskId: string }>('generate', { batchSize: 1, pollingIntervalSeconds: 1 }, async ([job]) => runGeneration(ctx, provider, job.data.taskId));
  await boss.work('grant-free-credits', async () => void (await grantFreeCredits(ctx)));
  await boss.work('expire-history', async () => void (await expireHistory(ctx)));
  await boss.work('reap-stuck', async () => void (await reapStuck(ctx)));
  await boss.work('cleanup-uploads', async () => void (await cleanupUploads(ctx)));
  await boss.work('dead-letter', async ([job]) => console.error('[worker] trabajo fallido definitivamente:', job.name, job.id));

  // cron en UTC
  await boss.schedule('grant-free-credits', '0 0 1 * *', {}, { tz: 'UTC' });
  await boss.schedule('expire-history', '15 * * * *', {}, { tz: 'UTC' });
  await boss.schedule('reap-stuck', '*/5 * * * *', {}, { tz: 'UTC' });
  await boss.schedule('cleanup-uploads', '30 3 * * *', {}, { tz: 'UTC' });

  // repartidor: cada segundo mira la cola de tareas y lanza las que caben
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      for (const id of await dispatch(ctx)) await boss.send('generate', { taskId: id }, { singletonKey: id });
    } catch (e) {
      console.error('[worker] repartidor:', (e as Error).message);
    } finally {
      busy = false;
    }
  }, 1000);

  return {
    async stop() {
      clearInterval(timer);
      await boss.stop({ graceful: true, timeout: 10_000 });
    },
  };
}
