import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import Stripe from 'stripe';
import { loadConfig } from '../src/config.js';
import { createApp, createCtx } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import type { Ctx } from '../src/context.js';
import type { Template } from '../src/lib/email.js';

export const WEBHOOK_SECRET = 'whsec_test_secreto_de_pruebas_123456';

export async function makeEnv() {
  const cfg = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env['TEST_DATABASE_URL']!,
    APP_URL: 'http://localhost:4300',
    PUBLIC_API_URL: 'http://localhost:8787',
    LOCAL_AUTH: '1',
    LOCAL_JWT_SECRET: 'x'.repeat(40),
    STORAGE_DRIVER: 'local',
    LOCAL_STORAGE_DIR: mkdtempSync(join(tmpdir(), 'my3dstudio-test-')),
    FILE_URL_SECRET: 'y'.repeat(40),
    STRIPE_SECRET_KEY: 'sk_test_solo_para_firmas',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    PROVIDER_MAX_CONCURRENCY: '50',
    // Precios de prueba fijos: los tests comprueban la lógica (congelar, devolver, renovar), no la tarifa.
    // La tarifa real está en la migración 0003 y en los valores por defecto de config.ts.
    CREDITS_HD: '15',
    CREDITS_TEXTURE_4K: '10',
    CREDITS_TEXTURE_8K: '20',
    CREDITS_SMART_PER_VARIANT: '100',
  });
  const sent: { to: string; t: Template }[] = [];
  const ctx: Ctx = createCtx(cfg, {
    mailer: { send: async (to, t) => void sent.push({ to, t }) },
    stripe: new Stripe(cfg.STRIPE_SECRET_KEY!),
  });
  await migrate(ctx.db, { local: true });
  await ctx.db.query(`update plans set monthly_credits = case id when 'free' then 200 when 'pro' then 3000 else monthly_credits end,
                        monthly_export_limit = case id when 'free' then 15 else monthly_export_limit end`);
  const app = createApp(ctx);
  return { cfg, ctx, app, sent, api: () => request(app) };
}

export type Env = Awaited<ReturnType<typeof makeEnv>>;

let n = 0;
export async function login(env: Env, label = 'persona'): Promise<{ token: string; id: string; email: string; h: { Authorization: string } }> {
  const email = `${label}-${Date.now()}-${++n}@example.com`;
  const r = await env.api().post('/api/dev/login').send({ email }).expect(200);
  const h = { Authorization: `Bearer ${r.body.token}` };
  await env.api().get('/api/me').set(h).expect(200); // primer acceso: crea el perfil, como en la app
  return { token: r.body.token, id: r.body.user.id, email, h };
}

/** PNG mínimo con cabecera IHDR válida del tamaño indicado (suficiente para la validación por cabecera). */
export function fakePng(w = 512, h = 512): Buffer {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

/** Sube una imagen por el flujo real: URL firmada → PUT → complete. */
export async function uploadImage(env: Env, h: { Authorization: string }, name = 'jarron.png', w = 512): Promise<string> {
  const png = fakePng(w, w);
  const r = await env.api().post('/api/uploads').set(h).send({ kind: 'image', contentType: 'image/png', sizeBytes: png.length, filename: name }).expect(201);
  const url = new URL(r.body.putUrl);
  await env.api().put(url.pathname + url.search).set('Content-Type', 'image/png').send(png).expect(200);
  await env.api().post(`/api/uploads/${r.body.uploadId}/complete`).set(h).expect(200);
  return r.body.uploadId;
}

export const PARAMS = { textureResolution: '2k', pbr: true, texture: true, topology: 'quad', faceLimit: 2000, variants: 1 } as const;

export async function credits(env: Env, h: { Authorization: string }) {
  return (await env.api().get('/api/me').set(h).expect(200)).body.credits as { available: number; frozen: number; monthly: number; permanent: number };
}
