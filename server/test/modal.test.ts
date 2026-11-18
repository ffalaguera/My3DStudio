import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ModalProvider } from '../src/provider/modal.js';
import { vesselGlb } from '../src/provider/fake.js';
import type { GenerationInput } from '../src/provider/provider.js';
import { dispatch, runGeneration } from '../src/jobs/worker.js';
import { credits, login, makeEnv, PARAMS, uploadImage, type Env } from './helpers.js';

// Servicio de Modal simulado con la misma API que gpu/trellis_service.py.
const TOKEN = 't'.repeat(40);
let server: Server;
let base = '';
let created: Record<string, unknown>[] = [];
let cancelled: string[] = [];
let mode: { fail?: boolean; slow?: boolean; notGlb?: boolean; reject422?: boolean } = {};
let glb: Buffer;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

beforeAll(async () => {
  glb = await vesselGlb(3, 24, 12, [0.3, 0.5, 0.7]);
  const app = express();
  app.use(express.json({ limit: '40mb' }));
  app.use((req, res, next) => (req.header('authorization') === `Bearer ${TOKEN}` ? next() : void res.status(401).json({ detail: 'token' })));
  const jobs = new Map<string, { body: Record<string, unknown>; polls: number }>();
  app.post('/jobs', (req, res) => {
    created.push(req.body);
    if (mode.reject422) return void res.status(422).json({ detail: 'parámetros no válidos' });
    const id = `fc-${randomUUID()}.k${created.length}`;
    jobs.set(id, { body: req.body, polls: 0 });
    res.json({ id });
  });
  app.get('/jobs/:id', (req, res) => {
    const j = jobs.get(req.params.id);
    if (!j) return void res.status(404).json({});
    j.polls++;
    if (mode.slow || j.polls < 3) return void res.json({ status: 'running', progress: Math.min(0.9, j.polls * 0.3) });
    if (mode.fail) return void res.json({ status: 'failed', error: 'RuntimeError: auditoría de licencias no limpia' });
    const n = j.body['kind'] === 'image' ? 1 : (j.body['seeds'] as number[]).length;
    res.json({ status: 'done', progress: 1, count: n });
  });
  app.get('/jobs/:id/file/:i', (req, res) => {
    const j = jobs.get(req.params.id)!;
    if (j.body['kind'] === 'image') return void res.type('image/png').send(PNG);
    res.type('model/gltf-binary').send(mode.notGlb ? Buffer.from('nope') : glb);
  });
  app.delete('/jobs/:id', (req, res) => {
    cancelled.push(req.params.id);
    res.json({ status: 'cancelled' });
  });
  await new Promise<void>((ok) => {
    server = app.listen(0, () => ok());
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));
beforeEach(() => {
  created = [];
  cancelled = [];
  mode = {};
});

const provider = (token = TOKEN) => new ModalProvider({ url: base, token, pollMs: 5 });
const input = (over: Partial<GenerationInput> = {}): GenerationInput => ({
  taskId: randomUUID(), type: 'image_to_model', series: 'hd', image: { bytes: PNG, contentType: 'image/png' },
  params: { texture: true, textureResolution: '2k', pbr: true, topology: 'tri', faceLimit: 8000, variants: 1 }, ...over,
});
const live = () => new AbortController().signal;

describe('ModalProvider contra un servicio simulado', () => {
  it('imagen → GLB: base64, decimación por caras, progreso creciente', async () => {
    const progress: number[] = [];
    const out = await provider().generate(input(), async (p) => void progress.push(p), live());
    expect(out.variants[0].subarray(0, 4).toString('ascii')).toBe('glTF');
    expect(out.modelVersion).toBe('trellis2-4b@modal');
    expect(created[0]).toMatchObject({ kind: 'model', resolution: 1024, decimation: 1_000_000, texture_size: 2048 });
    expect(Buffer.from(String(created[0]['image_b64']), 'base64').equals(PNG)).toBe(true);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(Math.max(...progress)).toBeLessThanOrEqual(94);
  });

  it('topología limpia con 4 variantes: un trabajo con 4 semillas distintas y caras = polígonos pedidos', async () => {
    const out = await provider().generate(input({ series: 'smart', params: { ...input().params, variants: 4, faceLimit: 3000 } }), async () => {}, live());
    expect(out.variants).toHaveLength(4);
    expect(created).toHaveLength(1);
    expect(created[0]['decimation']).toBe(3000);
    expect(new Set(created[0]['seeds'] as number[]).size).toBe(4);
  });

  it('texto → imagen (FLUX en Modal) → GLB', async () => {
    await provider().generate(input({ type: 'text_to_model', image: undefined, prompt: 'una tetera' }), async () => {}, live());
    expect(created.map((c) => c['kind'])).toEqual(['image', 'model']);
    expect(String(created[0]['prompt'])).toMatch(/^una tetera\. single object/);
    expect(Buffer.from(String(created[1]['image_b64']), 'base64').equals(PNG)).toBe(true);
  });

  it('errores: fallo del trabajo, 422, archivo no GLB y token rechazado', async () => {
    mode = { fail: true };
    await expect(provider().generate(input(), async () => {}, live())).rejects.toThrow(/no ha podido reconstruir/);
    mode = { reject422: true };
    await expect(provider().generate(input(), async () => {}, live())).rejects.toThrow('no acepta estos datos');
    mode = { notGlb: true };
    await expect(provider().generate(input(), async () => {}, live())).rejects.toThrow('archivo no válido');
    mode = {};
    await expect(provider('x'.repeat(40)).generate(input(), async () => {}, live())).rejects.toThrow('MODAL_SERVICE_TOKEN');
  });

  it('cancelar: aborta y pide la cancelación al servicio', async () => {
    mode = { slow: true };
    const ac = new AbortController();
    const run = provider().generate(input(), async () => {}, ac.signal);
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    await expect(run).rejects.toThrow('cancelada');
    await new Promise((r) => setTimeout(r, 30));
    expect(cancelled).toHaveLength(1);
  });

  it('"sin textura": el GLB llega sin imágenes', async () => {
    const out = await provider().generate(input({ params: { ...input().params, texture: false } }), async () => {}, live());
    const doc = await new NodeIO().readBinary(new Uint8Array(out.variants[0]));
    expect(doc.getRoot().listTextures()).toHaveLength(0);
  });
});

describe('trabajador con Modal (simulado) de punta a punta', () => {
  let env: Env;
  beforeAll(async () => {
    env = await makeEnv();
  });
  afterAll(async () => {
    await env.app.closeEvents();
    await env.ctx.db.end();
  });

  it('subida → tarea → modelo; si falla, créditos devueltos', async () => {
    const u = await login(env);
    const uploadId = await uploadImage(env, u.h);
    const body = { type: 'image_to_model', series: 'hd', uploadId, params: PARAMS, privacy: 'public' };
    const t = (await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID()).send(body).expect(201)).body.task;
    await dispatch(env.ctx);
    await runGeneration(env.ctx, provider(), t.id);
    expect((await env.api().get(`/api/tasks/${t.id}`).set(u.h)).body.task.status).toBe('success');

    mode.fail = true;
    const t2 = (await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID()).send(body).expect(201)).body.task;
    await dispatch(env.ctx);
    await runGeneration(env.ctx, provider(), t2.id);
    expect((await env.api().get(`/api/tasks/${t2.id}`).set(u.h)).body.task.status).toBe('failed');
    expect(await credits(env, u.h)).toMatchObject({ available: 185, frozen: 0 });
  });
});
