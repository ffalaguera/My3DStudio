import { z } from 'zod';

// Toda la configuración sale de variables de entorno (ver .env.example). Nada de secretos en el código.
const bool = z.enum(['0', '1', 'true', 'false']).default('0').transform((v) => v === '1' || v === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(8787),
    APP_URL: z.string().url().default('http://localhost:4300'),
    PUBLIC_API_URL: z.string().url().default('http://localhost:8787'),
    DATABASE_URL: z.string().min(1),
    RUN_WORKER: bool, // 1 = este proceso también ejecuta el trabajador (desarrollo)

    // Auth: Supabase en producción; LOCAL_AUTH solo para desarrollo y tests.
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_JWT_SECRET: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    LOCAL_AUTH: bool,
    LOCAL_JWT_SECRET: z.string().min(32).optional(),

    // Archivos
    STORAGE_DRIVER: z.enum(['local', 'r2']).default('local'),
    LOCAL_STORAGE_DIR: z.string().default('.data/storage'),
    FILE_URL_SECRET: z.string().min(32).optional(),
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET: z.string().optional(),

    // Pagos (modo test hasta /replica-deploy)
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    // Email
    EMAIL_DRIVER: z.enum(['console', 'resend']).default('console'),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default('Forma <hola@example.com>'),

    // Motor 3D y conversión
    GENERATION_PROVIDER: z.enum(['fake']).default('fake'),
    PROVIDER_MAX_CONCURRENCY: z.coerce.number().int().positive().default(4),
    BLENDER_PATH: z.string().optional(),
  })
  .superRefine((c, ctx) => {
    const need = (cond: boolean, path: string, message: string) => {
      if (cond) ctx.addIssue({ code: 'custom', path: [path], message });
    };
    need(c.NODE_ENV === 'production' && c.LOCAL_AUTH, 'LOCAL_AUTH', 'LOCAL_AUTH no se puede usar en producción');
    need(!c.LOCAL_AUTH && !c.SUPABASE_URL, 'SUPABASE_URL', 'hace falta SUPABASE_URL (o LOCAL_AUTH=1 en desarrollo)');
    need(c.LOCAL_AUTH && !c.LOCAL_JWT_SECRET, 'LOCAL_JWT_SECRET', 'hace falta con LOCAL_AUTH=1');
    need(c.STORAGE_DRIVER === 'local' && !c.FILE_URL_SECRET, 'FILE_URL_SECRET', 'hace falta con STORAGE_DRIVER=local');
    need(c.STORAGE_DRIVER === 'r2' && !(c.R2_ACCOUNT_ID && c.R2_ACCESS_KEY_ID && c.R2_SECRET_ACCESS_KEY && c.R2_BUCKET),
      'R2_BUCKET', 'faltan variables R2_*');
    need(c.NODE_ENV === 'production' && c.STORAGE_DRIVER === 'local', 'STORAGE_DRIVER', 'usa r2 en producción');
    need(c.EMAIL_DRIVER === 'resend' && !c.RESEND_API_KEY, 'RESEND_API_KEY', 'hace falta con EMAIL_DRIVER=resend');
    need(!!c.STRIPE_SECRET_KEY !== !!c.STRIPE_WEBHOOK_SECRET, 'STRIPE_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET van juntas');
    need(c.NODE_ENV !== 'production' && !!c.STRIPE_SECRET_KEY?.startsWith('sk_live_'), 'STRIPE_SECRET_KEY',
      'clave live fuera de producción: usa sk_test_ hasta /replica-deploy');
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = schema.safeParse(env);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida:\n${lines}`);
  }
  return r.data;
}
