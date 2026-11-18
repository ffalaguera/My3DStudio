import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import Stripe from 'stripe';
import type { Config } from './config.js';
import type { Ctx } from './context.js';
import { createPool } from './db.js';
import { requireUser } from './lib/auth.js';
import { createMailer } from './lib/email.js';
import { setCreditCosts } from './lib/credits.js';
import { errorHandler, HttpError } from './lib/http.js';
import { createStorage } from './lib/storage.js';
import { accountRoutes } from './routes/account.js';
import { assetRoutes } from './routes/assets.js';
import { billingRoutes, stripeWebhook } from './routes/billing.js';
import { eventRoutes } from './routes/events.js';
import { localFiles } from './routes/files.js';
import { taskRoutes } from './routes/tasks.js';
import { uploadRoutes } from './routes/uploads.js';

export function createCtx(cfg: Config, overrides: Partial<Ctx> = {}): Ctx {
  setCreditCosts({ hd: cfg.CREDITS_HD, texture4k: cfg.CREDITS_TEXTURE_4K, texture8k: cfg.CREDITS_TEXTURE_8K,
    smartPerVariant: cfg.CREDITS_SMART_PER_VARIANT });
  const db = overrides.db ?? createPool(cfg.DATABASE_URL);
  return {
    cfg,
    db,
    storage: overrides.storage ?? createStorage(cfg),
    mailer: overrides.mailer ?? createMailer(cfg),
    stripe: overrides.stripe !== undefined ? overrides.stripe : cfg.STRIPE_SECRET_KEY ? new Stripe(cfg.STRIPE_SECRET_KEY) : null,
    deleteAuthUser: overrides.deleteAuthUser ?? (async (userId) => {
      if (cfg.LOCAL_AUTH) {
        await db.query('delete from auth.users where id = $1', [userId]);
        return;
      }
      // API de administración de Supabase (requiere la service role key, solo en el servidor)
      const r = await fetch(new URL(`/auth/v1/admin/users/${userId}`, cfg.SUPABASE_URL), {
        method: 'DELETE',
        headers: { apikey: cfg.SUPABASE_SERVICE_ROLE_KEY ?? '', Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY ?? ''}` },
      });
      if (!r.ok && r.status !== 404) throw new Error(`Supabase admin: ${r.status}`);
    }),
  };
}

export function createApp(ctx: Ctx) {
  const { cfg } = ctx;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: cfg.APP_URL, allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'], maxAge: 600 }));

  // Webhook antes del parser JSON: Stripe firma el cuerpo crudo.
  app.use('/api/webhooks/stripe', stripeWebhook(ctx));
  if (cfg.STORAGE_DRIVER === 'local') app.use('/files', localFiles(ctx));

  app.use(express.json({ limit: '100kb' }));
  app.get('/health', async (_req, res) => {
    await ctx.db.query('select 1');
    res.json({ ok: true });
  });

  const test = cfg.NODE_ENV === 'test' && !process.env['TEST_REAL_RATE_LIMITS'];
  const limiter = (limit: number, windowMs = 60_000) =>
    rateLimit({ windowMs, limit: test ? 10_000 : limit, standardHeaders: 'draft-7', legacyHeaders: false,
      keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anon',
      handler: (_req, _res, next) => next(new HttpError(429, 'rate_limited', 'Demasiadas peticiones. Espera un momento')) });

  const auth = requireUser(cfg, ctx.db);
  const events = eventRoutes(ctx);

  app.use('/api/dev', limiter(60)); // solo existe con LOCAL_AUTH (desarrollo y e2e)
  app.use('/api', accountRoutes(ctx, auth));
  app.use('/api/uploads', auth, limiter(30), uploadRoutes(ctx));
  // BUG-005: el limitador se crea una vez; creado dentro del middleware empezaba de cero en cada petición
  const createTaskLimit = limiter(30);
  app.use('/api/tasks', auth, (req, res, next) => (req.method === 'POST' ? createTaskLimit(req, res, next) : next()), taskRoutes(ctx));
  app.use('/api/assets', auth, limiter(120), assetRoutes(ctx));
  app.use('/api/billing', auth, limiter(10), billingRoutes(ctx));
  app.use('/api/events', auth, events);
  app.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Ruta no encontrada')));
  app.use(errorHandler);
  return Object.assign(app, { closeEvents: () => events.close() });
}
