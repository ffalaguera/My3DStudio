import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { FalProvider } from '../src/provider/fal.js';
import { vesselGlb } from '../src/provider/fake.js';
import { ProviderError, type GenerationInput } from '../src/provider/provider.js';
import { dispatch, runGeneration } from '../src/jobs/worker.js';
import { credits, login, makeEnv, PARAMS, uploadImage, type Env } from './helpers.js';

// fal simulado: imita la cola REST (submit → status → response → cancel) para probar sin gastar.
interface Call { model: string; body: Record<string, unknown> }
let server: Server;
let base = '';
let calls: Call[] = [];
let cancels: string[] = [];
let behaviour: { submit422?: boolean; runError?: boolean; nsfw?: boolean; badGlb?: boolean; foreignUrl?: boolean; slow?: boolean; llmDown?: boolean; llmEmpty?: boolean } = {};
let llmCalls: Record<string, unknown>[] = [];
let glb: Buffer;

beforeAll(async () => {
  glb = await vesselGlb(7, 24, 12, [0.6, 0.3, 0.2]);
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  const reqs = new Map<string, { model: string; polls: number }>();
  // LLM de traducción (OpenRouter en fal, compatible con OpenAI; llamada directa, sin cola)
  app.post('/openrouter/router/openai/v1/chat/completions', (req, res) => {
    llmCalls.push(req.body);
    if (behaviour.llmDown) return void res.status(503).json({ detail: 'no disponible' });
    const content = behaviour.llmEmpty ? '' : '"a white ceramic teapot with a bamboo handle"';
    res.json({ choices: [{ message: { role: 'assistant', content } }] });
  });
  app.post(/^\/(.+)$/, (req, res) => {
    const model = (req.params as unknown as string[])[0];
    calls.push({ model, body: req.body });
    if (behaviour.submit422) return void res.status(422).json({ detail: [{ msg: 'imagen no válida' }] });
    const id = randomUUID();
    reqs.set(id, { model, polls: 0 });
    const app2 = model.split('/').slice(0, 2).join('/');
    res.json({
      request_id: id, queue_position: 0,
      status_url: `${base}/${app2}/requests/${id}/status`, response_url: `${base}/${app2}/requests/${id}`,
      cancel_url: `${base}/${app2}/requests/${id}/cancel`,
    });
  });
  app.get(/\/requests\/([^/]+)\/status$/, (req, res) => {
    const r = reqs.get((req.params as unknown as string[])[0])!;
    r.polls++;
    const limit = behaviour.slow ? 1000 : 2;
    if (r.polls < limit) return void res.json({ status: r.polls === 1 ? 'IN_QUEUE' : 'IN_PROGRESS', queue_position: 1 });
    res.json(behaviour.runError
      ? { status: 'COMPLETED', error: 'CUDA out of memory', error_type: 'runner_server_error' }
      : { status: 'COMPLETED' });
  });
  app.get(/\/requests\/([^/]+)$/, (req, res) => {
    const r = reqs.get((req.params as unknown as string[])[0])!;
    if (r.model.includes('flux')) {
      return void res.json({ images: [{ url: `${base}/files/ref.png` }], has_nsfw_concepts: [!!behaviour.nsfw] });
    }
    res.json({ model_glb: { url: behaviour.foreignUrl ? 'http://169.254.169.254/latest/meta-data' : `${base}/files/model.glb` } });
  });
  app.put(/\/requests\/([^/]+)\/cancel$/, (req, res) => {
    cancels.push((req.params as unknown as string[])[0]);
    res.json({ status: 'CANCELLATION_REQUESTED' });
  });
  app.get('/files/model.glb', (_req, res) => void res.type('model/gltf-binary').send(behaviour.badGlb ? Buffer.from('<html>no</html>') : glb));
  await new Promise<void>((ok) => {
    server = app.listen(0, () => ok());
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));
beforeEach(() => {
  llmCalls = [];
  calls = [];
  cancels = [];
  behaviour = {};
});

const provider = () => new FalProvider({ key: 'clave-de-prueba', baseUrl: base, syncBaseUrl: base, pollMs: 5 });
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const input = (over: Partial<GenerationInput> = {}): GenerationInput => ({
  taskId: randomUUID(), type: 'image_to_model', series: 'hd', image: { bytes: png, contentType: 'image/png' },
  params: { texture: true, textureResolution: '4k', pbr: true, topology: 'tri', faceLimit: 10000, variants: 1 }, ...over,
});
const noAbort = () => new AbortController().signal;

describe('FalProvider contra un fal simulado', () => {
  it('imagen → TRELLIS.2: data URI, parámetros mapeados, GLB descargado y progreso creciente', async () => {
    const progress: number[] = [];
    const out = await provider().generate(input(), async (p) => void progress.push(p), noAbort());
    expect(out.variants).toHaveLength(1);
    expect(out.variants[0].subarray(0, 4).toString('ascii')).toBe('glTF');
    expect(out.modelVersion).toBe('fal:fal-ai/trellis-2');
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe('fal-ai/trellis-2');
    expect(String(calls[0].body['image_url'])).toMatch(/^data:image\/png;base64,/);
    expect(calls[0].body).toMatchObject({ texture_size: 4096, decimation_target: 500000, remesh: true, resolution: 1024 });
    expect(progress.length).toBeGreaterThan(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(Math.max(...progress)).toBeLessThan(95);
  });

  it('topología limpia con 2 variantes: 2 peticiones con semillas distintas y decimación = polígonos pedidos', async () => {
    const out = await provider().generate(input({ series: 'smart', params: { ...input().params, faceLimit: 5000, variants: 2 } }), async () => {}, noAbort());
    expect(out.variants).toHaveLength(2);
    expect(calls.map((c) => c.body['decimation_target'])).toEqual([5000, 5000]);
    expect(new Set(calls.map((c) => c.body['seed'])).size).toBe(2);
  });

  it('texto → traducción al inglés → FLUX (referencia) → TRELLIS.2 con la imagen generada', async () => {
    await provider().generate(input({ type: 'text_to_model', image: undefined, prompt: 'una tetera de cerámica blanca con asa de bambú' }), async () => {}, noAbort());
    expect(llmCalls).toHaveLength(1);
    expect(llmCalls[0]).toMatchObject({ model: 'google/gemini-2.5-flash-lite', temperature: 0 });
    const msgs = llmCalls[0]['messages'] as { role: string; content: string }[];
    expect(msgs[0].role).toBe('system');
    expect(msgs[1]).toEqual({ role: 'user', content: 'una tetera de cerámica blanca con asa de bambú' });
    expect(calls.map((c) => c.model)).toEqual(['fal-ai/flux/schnell', 'fal-ai/trellis-2']);
    // sin comillas y en inglés
    expect(String(calls[0].body['prompt'])).toMatch(/^a white ceramic teapot with a bamboo handle\. single object/);
    expect(calls[0].body['enable_safety_checker']).toBe(true);
    expect(calls[1].body['image_url']).toBe(`${base}/files/ref.png`);
  });

  it('si la traducción falla o viene vacía, se usa el texto original (nunca bloquea)', async () => {
    for (const b of [{ llmDown: true }, { llmEmpty: true }]) {
      behaviour = b;
      calls = [];
      await provider().generate(input({ type: 'text_to_model', image: undefined, prompt: 'una lámpara' }), async () => {}, noAbort());
      expect(String(calls[0].body['prompt'])).toMatch(/^una lámpara\. single object/);
    }
  });

  it('texto no permitido: se para antes del 3D', async () => {
    behaviour.nsfw = true;
    await expect(provider().generate(input({ type: 'text_to_model', image: undefined, prompt: 'x' }), async () => {}, noAbort()))
      .rejects.toThrow('La descripción no está permitida');
    expect(calls.map((c) => c.model)).toEqual(['fal-ai/flux/schnell']);
  });

  it('errores: 422 al enviar, fallo en la ejecución, archivo que no es GLB y URL fuera de fal', async () => {
    behaviour = { submit422: true };
    await expect(provider().generate(input(), async () => {}, noAbort())).rejects.toThrow(/no ha podido usar esta imagen/);
    behaviour = { runError: true };
    const e = await provider().generate(input(), async () => {}, noAbort()).catch((x) => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.message).toMatch(/no ha podido reconstruir/);
    behaviour = { badGlb: true };
    await expect(provider().generate(input(), async () => {}, noAbort())).rejects.toThrow('archivo no válido');
    behaviour = { foreignUrl: true };
    await expect(provider().generate(input(), async () => {}, noAbort())).rejects.toThrow('archivo no válido');
  });

  it('clave rechazada (401) o cuenta sin saldo (403): el usuario ve un mensaje genérico y el detalle va al log', async () => {
    const logged: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a.join(' '));
    try {
      for (const [status, detail, hint] of [
        [401, 'invalid key credentials', /FAL_KEY/],
        [403, 'User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing.', /saldo/],
      ] as const) {
        logged.length = 0;
        const p = new FalProvider({ key: 'k', baseUrl: base, pollMs: 5,
          fetch: async () => new Response(JSON.stringify({ detail }), { status }) });
        const e = await p.generate(input(), async () => {}, noAbort()).catch((x) => x);
        expect(e).toBeInstanceOf(ProviderError);
        expect(e.message).toBe('El motor 3D no está disponible ahora mismo. Te hemos devuelto los créditos');
        expect(e.message).not.toMatch(/FAL_KEY|saldo|balance/);
        expect(logged.join('\n')).toMatch(hint); // quien opera la app sí ve qué pasa
      }
    } finally {
      console.error = orig;
    }
  });

  it('cancelar: aborta y pide la cancelación a fal', async () => {
    behaviour.slow = true;
    const ac = new AbortController();
    const run = provider().generate(input(), async () => {}, ac.signal);
    await new Promise((r) => setTimeout(r, 60));
    ac.abort();
    await expect(run).rejects.toThrow('cancelada');
    await new Promise((r) => setTimeout(r, 30));
    expect(cancels).toHaveLength(1);
  });

  it('"sin textura": el GLB llega sin imágenes', async () => {
    const out = await provider().generate(input({ params: { ...input().params, texture: false } }), async () => {}, noAbort());
    const doc = await new NodeIO().readBinary(new Uint8Array(out.variants[0]));
    expect(doc.getRoot().listTextures()).toHaveLength(0);
    expect(calls[0].body['texture_size']).toBe(1024);
  });
});

describe('trabajador con fal (simulado) de punta a punta', () => {
  let env: Env;
  beforeAll(async () => {
    env = await makeEnv();
  });
  afterAll(async () => {
    await env.app.closeEvents();
    await env.ctx.db.end();
  });

  it('imagen subida → tarea → modelo guardado; si fal falla, créditos devueltos', async () => {
    const u = await login(env);
    const uploadId = await uploadImage(env, u.h);
    const t = (await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID())
      .send({ type: 'image_to_model', series: 'hd', uploadId, params: PARAMS, privacy: 'public' }).expect(201)).body.task;
    await dispatch(env.ctx);
    await runGeneration(env.ctx, provider(), t.id);
    const done = (await env.api().get(`/api/tasks/${t.id}`).set(u.h)).body.task;
    expect(done.status).toBe('success');
    const asset = (await env.api().get(`/api/assets/${done.assetIds[0]}`).set(u.h)).body.asset;
    expect(asset.faceCount).toBeGreaterThan(0);
    expect(String(calls[0].body['image_url'])).toMatch(/^data:image\/png;base64,/);

    behaviour.runError = true;
    const t2 = (await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID())
      .send({ type: 'image_to_model', series: 'hd', uploadId, params: PARAMS, privacy: 'public' }).expect(201)).body.task;
    await dispatch(env.ctx);
    await runGeneration(env.ctx, provider(), t2.id);
    const failed = (await env.api().get(`/api/tasks/${t2.id}`).set(u.h)).body.task;
    expect(failed.status).toBe('failed');
    expect(failed.errorMessage).toMatch(/no ha podido reconstruir/);
    expect(await credits(env, u.h)).toMatchObject({ available: 185, frozen: 0 });
  });
});
