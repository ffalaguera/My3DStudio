import { z } from 'zod';
import type { Db, Tx } from '../db.js';
import { costOf, planOf, type PlanRow } from './credits.js';

export const paramsSchema = z.object({
  textureResolution: z.enum(['2k', '4k', '8k']).default('2k'),
  pbr: z.boolean().default(true),
  texture: z.boolean().default(true),
  topology: z.enum(['tri', 'quad']).default('quad'),
  faceLimit: z.number().int().min(500).max(25000).default(10000),
  variants: z.union([z.literal(1), z.literal(2), z.literal(4)]).default(1),
});

/** Para estimar no hace falta tener ya la imagen o el texto: el coste solo depende de serie y ajustes. */
export const estimateSchema = z.object({
  type: z.enum(['image_to_model', 'text_to_model']),
  series: z.enum(['hd', 'smart']),
  prompt: z.string().max(1024).optional(),
  texturePrompt: z.string().max(1024).optional(),
  uploadId: z.string().uuid().optional(),
  params: z.lazy(() => paramsSchema),
  privacy: z.enum(['public', 'private']).default('public'),
});

export const taskRequestSchema = z.object({
  type: z.enum(['image_to_model', 'text_to_model']),
  series: z.enum(['hd', 'smart']),
  prompt: z.string().trim().min(1).max(1024).optional(),
  texturePrompt: z.string().trim().max(1024).optional(),
  uploadId: z.string().uuid().optional(),
  params: paramsSchema,
  privacy: z.enum(['public', 'private']).default('public'),
}).superRefine((r, ctx) => {
  if (r.type === 'text_to_model' && !r.prompt) ctx.addIssue({ code: 'custom', path: ['prompt'], message: 'Describe el objeto' });
  if (r.type === 'image_to_model' && !r.uploadId) ctx.addIssue({ code: 'custom', path: ['uploadId'], message: 'Sube una imagen' });
});
export type TaskRequest = z.infer<typeof taskRequestSchema>;

export interface Estimate {
  credits: number;
  etaSeconds: number;
  allowed: boolean;
  reason?: 'insufficient_credits' | 'plan_feature';
  detail?: string;
}

const ORDER = ['2k', '4k', '8k'] as const;

/** La misma lógica para /tasks/estimate y para crear la tarea (dentro de la transacción). */
export async function evaluate(c: Tx | Db, userId: string, req: TaskRequest, opts: { free?: boolean } = {}): Promise<Estimate & { plan: PlanRow }> {
  const plan = await planOf(c, userId);
  const params = { ...req.params, variants: req.series === 'smart' ? req.params.variants : 1 };
  const credits = opts.free ? 0 : costOf(req.series, params);
  const etaSeconds = req.series === 'hd' ? 180 : 30;
  const deny = (detail: string) => ({ credits, etaSeconds, allowed: false, reason: 'plan_feature' as const, detail, plan });
  if (req.series === 'smart' && !plan.allow_smart_mesh) return deny('La topología limpia está en los planes de pago');
  if (req.privacy === 'private' && !plan.allow_private) return deny('Los modelos privados están en los planes de pago');
  if (params.variants > plan.max_variants) return deny(`Tu plan permite ${plan.max_variants} variante por generación`);
  if (req.series === 'hd' && params.texture && ORDER.indexOf(params.textureResolution) > ORDER.indexOf(plan.max_texture_resolution)) {
    return deny(`Las texturas ${params.textureResolution.toUpperCase()} no están en tu plan`);
  }
  if (plan.max_saved_models !== null) {
    const saved = Number((await c.query(`select count(*) from assets where user_id = $1`, [userId])).rows[0].count);
    if (saved + params.variants > plan.max_saved_models) {
      return deny(`Has llegado a ${plan.max_saved_models} modelos guardados. Borra alguno o mejora tu plan`);
    }
  }
  const acc = (await c.query(`select monthly_balance + permanent_balance as available from credit_accounts where user_id = $1`, [userId])).rows[0];
  const available = Number(acc?.available ?? 0);
  if (available < credits) {
    return { credits, etaSeconds, allowed: false, reason: 'insufficient_credits', detail: `Te faltan ${credits - available} créditos`, plan };
  }
  return { credits, etaSeconds, allowed: true, plan };
}
