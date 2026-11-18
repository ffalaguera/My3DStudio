import type { Db, Tx } from '../db.js';
import type { Storage } from './storage.js';
import type { PlanRow } from './credits.js';

// Convierte filas de la base en los tipos de web/src/app/data/api.ts (camelCase).

export function plan(p: PlanRow) {
  return {
    id: p.id, name: p.name, priceMonthCents: p.price_month_cents, priceYearCents: p.price_year_cents, currency: p.currency,
    monthlyCredits: p.monthly_credits, maxConcurrentTasks: p.max_concurrent_tasks, maxVariants: p.max_variants,
    monthlyExportLimit: p.monthly_export_limit, maxSavedModels: p.max_saved_models, historyDays: p.history_days,
    maxTextureResolution: p.max_texture_resolution, allowPrivate: p.allow_private, allowCommercial: p.allow_commercial,
    allowSmartMesh: p.allow_smart_mesh,
  };
}

const TASK_SQL = `
  select t.*,
    (select u.storage_key from task_inputs i join uploads u on u.id = i.upload_id where i.task_id = t.id order by i.view limit 1) as input_key,
    coalesce((select array_agg(a.id order by a.variant_index) from assets a where a.task_id = t.id), '{}') as asset_ids,
    case when t.status = 'queued' then
      (select count(*) from tasks q where q.user_id = t.user_id and q.status = 'queued' and q.created_at <= t.created_at)
    end as queue_position
  from tasks t`;

export async function tasks(c: Tx | Db, s: Storage, where: string, args: unknown[]) {
  const r = await c.query(`${TASK_SQL} where ${where} order by t.created_at desc limit 30`, args);
  return Promise.all(r.rows.map(async (t) => ({
    id: t.id, type: t.type, series: t.series, status: t.status, progress: t.progress,
    queuePosition: t.queue_position === null ? null : Number(t.queue_position),
    prompt: t.prompt ?? undefined,
    inputPreviewUrl: t.input_key ? await s.signedGet(t.input_key) : undefined,
    params: t.params, creditsCost: t.credits_cost, assetIds: t.asset_ids,
    errorMessage: t.error_message ?? undefined,
    createdAt: t.created_at.toISOString(), finishedAt: t.finished_at?.toISOString(),
  })));
}

const ASSET_SQL = `
  select a.*, (select f.storage_key from asset_files f where f.asset_id = a.id and f.format = 'glb' and f.options_hash = 'default') as glb_key
  from assets a`;

export async function assets(c: Tx | Db, s: Storage, where: string, args: unknown[], withGlb: boolean) {
  const r = await c.query(`${ASSET_SQL} where ${where} order by a.created_at desc, a.variant_index limit 200`, args);
  return Promise.all(r.rows.map(async (a) => ({
    id: a.id, taskId: a.task_id, name: a.name, prompt: a.prompt ?? undefined, series: a.series,
    thumbnailUrl: a.thumbnail_key ? await s.signedGet(a.thumbnail_key) : null,
    glbUrl: withGlb && a.glb_key ? await s.signedGet(a.glb_key) : '',
    faceCount: a.face_count ?? 0, vertexCount: a.vertex_count ?? 0, topology: a.topology ?? 'tri',
    textureResolution: a.texture_resolution, hasTexture: a.has_texture, privacy: a.privacy, license: a.license,
    expiresAt: a.expires_at?.toISOString() ?? null, createdAt: a.created_at.toISOString(),
  })));
}
