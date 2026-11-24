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

    // Auth: «self» = acceso propio con Better Auth en tu Postgres (sin servicios externos); «supabase» = Supabase Auth.
    // LOCAL_AUTH=1 solo para desarrollo y tests.
    AUTH_PROVIDER: z.enum(['self', 'supabase']).default('supabase'),
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
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
    EMAIL_FROM: z.string().default('My3DStudio <hola@example.com>'),

    // Motor 3D y conversión
    GENERATION_PROVIDER: z.enum(['fake', 'fal']).default('fake'),
    FAL_KEY: z.string().optional(),
    FAL_BASE_URL: z.string().url().optional(),
    // Coste en créditos: tarifa de lanzamiento (replica/launch/pricing.md). Con fal cada modelo cuesta ~0,28 €
    CREDITS_HD: z.coerce.number().int().positive().default(50),
    CREDITS_TEXTURE_4K: z.coerce.number().int().min(0).default(10),
    CREDITS_TEXTURE_8K: z.coerce.number().int().min(0).default(20),
    CREDITS_SMART_PER_VARIANT: z.coerce.number().int().positive().default(50),
    PROVIDER_MAX_CONCURRENCY: z.coerce.number().int().positive().default(4),
    // Freno de gasto: como mucho N llamadas al motor por día (UTC). Las demás esperan en cola al día siguiente.
    // Con fal ≈ 0,28 € por modelo: 20/día ≈ 5,60 € como máximo. 0 = sin tope.
    GENERATION_DAILY_LIMIT: z.coerce.number().int().min(0).default(20),
    // Vista previa (solo la imagen, ≈ 0,003 € con fal): tope por persona y día para que no se use como generador de imágenes gratis
    PREVIEW_DAILY_LIMIT: z.coerce.number().int().min(0).default(30),
    // Modelo de negocio. shop: generar es gratis (con tope) y se venden figuras impresas; nunca se entregan archivos.
    // credits: el modelo anterior (créditos, planes y descargas). Se conserva para poder volver atrás.
    BUSINESS_MODEL: z.enum(['shop', 'credits']).default('shop'),
    // Tienda: generaciones gratis por persona y día (cada una cuesta ~0,28 € con fal). 0 = sin tope.
    GENERATION_FREE_PER_DAY: z.coerce.number().int().min(0).default(3),
    // Emails con acceso al panel del taller (pedidos y archivos para imprimir), separados por comas.
    ADMIN_EMAILS: z.string().default(''),
    BLENDER_PATH: z.string().optional(),
  })
  .superRefine((c, ctx) => {
    const need = (cond: boolean, path: string, message: string) => {
      if (cond) ctx.addIssue({ code: 'custom', path: [path], message });
    };
    need(c.NODE_ENV === 'production' && c.LOCAL_AUTH, 'LOCAL_AUTH', 'LOCAL_AUTH no se puede usar en producción');
    need(!c.LOCAL_AUTH && c.AUTH_PROVIDER === 'supabase' && !c.SUPABASE_URL, 'SUPABASE_URL',
      'hace falta SUPABASE_URL (o AUTH_PROVIDER=self, o LOCAL_AUTH=1 en desarrollo)');
    need(c.AUTH_PROVIDER === 'self' && !c.LOCAL_AUTH && !c.BETTER_AUTH_SECRET, 'BETTER_AUTH_SECRET',
      'hace falta con AUTH_PROVIDER=self: una cadena aleatoria de 32+ caracteres');
    need(!!c.GOOGLE_CLIENT_ID !== !!c.GOOGLE_CLIENT_SECRET, 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET van juntas');
    need(c.LOCAL_AUTH && !c.LOCAL_JWT_SECRET, 'LOCAL_JWT_SECRET', 'hace falta con LOCAL_AUTH=1');
    need(c.STORAGE_DRIVER === 'local' && !c.FILE_URL_SECRET, 'FILE_URL_SECRET', 'hace falta con STORAGE_DRIVER=local');
    need(c.STORAGE_DRIVER === 'r2' && !(c.R2_ACCOUNT_ID && c.R2_ACCESS_KEY_ID && c.R2_SECRET_ACCESS_KEY && c.R2_BUCKET),
      'R2_BUCKET', 'faltan variables R2_*');
    // En tu propio servidor (Oracle) los archivos pueden ir en disco: ruta absoluta en un volumen que no se borre.
    need(c.NODE_ENV === 'production' && c.STORAGE_DRIVER === 'local' && !c.LOCAL_STORAGE_DIR.startsWith('/'), 'LOCAL_STORAGE_DIR',
      'en producción con STORAGE_DRIVER=local usa una ruta absoluta en un volumen persistente (p. ej. /data/storage)');
    need(c.GENERATION_PROVIDER === 'fal' && !c.FAL_KEY, 'FAL_KEY', 'hace falta con GENERATION_PROVIDER=fal');
    need(c.NODE_ENV === 'production' && c.GENERATION_PROVIDER === 'fake', 'GENERATION_PROVIDER', 'el motor falso no se usa en producción');
    need(c.EMAIL_DRIVER === 'resend' && !c.RESEND_API_KEY, 'RESEND_API_KEY', 'hace falta con EMAIL_DRIVER=resend');
    // con acceso propio los enlaces de entrada van por email: en producción tienen que enviarse de verdad
    need(c.NODE_ENV === 'production' && c.AUTH_PROVIDER === 'self' && c.EMAIL_DRIVER !== 'resend', 'EMAIL_DRIVER',
      'con AUTH_PROVIDER=self en producción hace falta EMAIL_DRIVER=resend (si no, nadie recibe el enlace para entrar)');
    need(!!c.STRIPE_SECRET_KEY !== !!c.STRIPE_WEBHOOK_SECRET, 'STRIPE_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET van juntas');
    // Producción: todo por HTTPS, base de datos con TLS y claves de Stripe reales
    const prod = c.NODE_ENV === 'production';
    need(prod && !c.APP_URL.startsWith('https://'), 'APP_URL', 'en producción APP_URL tiene que ser https://');
    need(prod && !c.PUBLIC_API_URL.startsWith('https://'), 'PUBLIC_API_URL', 'en producción PUBLIC_API_URL tiene que ser https://');
    // Excepción: una base en la red interna de Docker (host sin dominio, como «db»), que no sale a internet.
    const dbHost = (() => { try { return new URL(c.DATABASE_URL).hostname; } catch { return ''; } })();
    const internalDb = dbHost !== '' && !dbHost.includes('.') && dbHost !== 'localhost';
    need(prod && !internalDb && !/[?&]sslmode=(require|verify-ca|verify-full)/.test(c.DATABASE_URL), 'DATABASE_URL',
      'en producción la conexión a la base debe ir cifrada: añade ?sslmode=require (o verify-full)');
    need(prod && !!c.STRIPE_SECRET_KEY && !c.STRIPE_SECRET_KEY.startsWith('sk_live_'), 'STRIPE_SECRET_KEY',
      'en producción hace falta una clave sk_live_ (las de prueba no cobran)');
    need(c.NODE_ENV !== 'production' && !!c.STRIPE_SECRET_KEY?.startsWith('sk_live_'), 'STRIPE_SECRET_KEY',
      'clave live fuera de producción: usa sk_test_ hasta /replica-deploy');
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // `VAR=` vacía (como en .env.example) cuenta como no definida
  const clean = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const r = schema.safeParse(clean);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida:\n${lines}`);
  }
  return r.data;
}
