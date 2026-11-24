import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Document, NodeIO } from '@gltf-transform/core';
import { unzipSync, strFromU8 } from 'fflate';
import { convert, printReport } from '../src/lib/convert.js';
import { vesselGlb } from '../src/provider/fake.js';
import { credits, login, makeEnv, PARAMS, type Env } from './helpers.js';

// Diferenciación (replica/competencia.md): ver la imagen antes de pagar el modelo, y archivos listos para imprimir.
let env: Env;
beforeAll(async () => {
  env = await makeEnv({ env: { PREVIEW_DAILY_LIMIT: '3' } });
});
afterAll(async () => {
  await env.app.closeEvents();
  await env.ctx.db.end();
});

const drain = async () => {
  const { dispatch, runGeneration, createProvider } = await import('../src/jobs/worker.js');
  const provider = createProvider(env.ctx);
  for (const id of await dispatch(env.ctx)) await runGeneration(env.ctx, provider, id);
};

describe('vista previa antes de pagar (texto a 3D)', () => {
  it('genera la imagen de referencia sin cobrar créditos y se puede convertir en modelo', async () => {
    const u = await login(env);
    const before = await credits(env, u.h);
    const r = await env.api().post('/api/tasks/preview').set(u.h).send({ prompt: 'un búho de cerámica' }).expect(201);
    expect(r.body.upload).toMatchObject({ id: expect.any(String), previewUrl: expect.any(String), width: 512, height: 512 });
    expect(await credits(env, u.h)).toEqual(before); // ver la imagen no cuesta créditos
    // aprobada: el modelo sale de esa imagen al precio normal
    const t = await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID())
      .send({ type: 'image_to_model', series: 'hd', uploadId: r.body.upload.id, privacy: 'public', params: PARAMS }).expect(201);
    expect(t.body.task.creditsCost).toBe(15);
  });

  it('pide saldo para un modelo (evita usar la vista previa gratis sin intención de comprar)', async () => {
    const u = await login(env);
    await env.ctx.db.query('update credit_accounts set monthly_balance = 0, permanent_balance = 0 where user_id = $1', [u.id]);
    const r = await env.api().post('/api/tasks/preview').set(u.h).send({ prompt: 'una taza' }).expect(402);
    expect(r.body.error.code).toBe('insufficient_credits');
  });

  it('tiene tope diario por persona', async () => {
    const u = await login(env);
    for (let i = 0; i < 3; i++) await env.api().post('/api/tasks/preview').set(u.h).send({ prompt: `una silla ${i}` }).expect(201);
    const r = await env.api().post('/api/tasks/preview').set(u.h).send({ prompt: 'una silla 4' }).expect(429);
    expect(r.body.error.code).toBe('preview_limit');
  });

  it('una cuenta bloqueada no puede pedir vistas previas', async () => {
    const u = await login(env);
    await env.ctx.db.query(`update profiles set blocked_at = now() where id = $1`, [u.id]);
    await env.api().post('/api/tasks/preview').set(u.h).send({ prompt: 'una lámpara' }).expect(403);
  });

  it('valida el texto y exige sesión', async () => {
    await env.api().post('/api/tasks/preview').send({ prompt: 'x' }).expect(401);
    const u = await login(env);
    await env.api().post('/api/tasks/preview').set(u.h).send({ prompt: '' }).expect(422);
  });
});

/** Cubo cerrado de 2 × 2 × 2 m (8 vértices, 12 triángulos), con +Y hacia arriba como en glTF. */
async function cubeGlb(): Promise<Buffer> {
  const d = new Document();
  const buf = d.createBuffer();
  const p = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1];
  const ix = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3];
  const prim = d.createPrimitive()
    .setAttribute('POSITION', d.createAccessor().setType('VEC3').setArray(new Float32Array(p)).setBuffer(buf))
    .setIndices(d.createAccessor().setType('SCALAR').setArray(new Uint32Array(ix)).setBuffer(buf));
  d.createScene().addChild(d.createNode().setMesh(d.createMesh().addPrimitive(prim)));
  return Buffer.from(await new NodeIO().writeBinary(d));
}

/** Lee un STL binario: caja (x, y, z) y número de triángulos. */
function stlBox(b: Buffer) {
  const n = b.readUInt32LE(80);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < n; t++) for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) {
    const x = b.readFloatLE(84 + t * 50 + 12 + v * 12 + a * 4);
    min[a] = Math.min(min[a], x); max[a] = Math.max(max[a], x);
  }
  return { n, min, max, size: max.map((m, i) => m - min[i]) };
}

describe('kit de impresión (STL y 3MF)', () => {
  it('STL a la altura pedida en milímetros, de pie (Z hacia arriba) y apoyado en z = 0', async () => {
    const glb = await vesselGlb(5, 16, 8, [0.5, 0.5, 0.5]); // 1,8 m de alto en Y
    const box = stlBox(await convert(glb, 'stl', undefined, { heightMm: 60, base: false }));
    expect(box.size[2]).toBeCloseTo(60, 1);
    expect(box.min[2]).toBeCloseTo(0, 3);
    expect(box.size[1]).toBeLessThan(60); // lo que era alto en Y ya no está en Y
  });

  it('peana opcional: añade su disco debajo y el modelo queda encima', async () => {
    const glb = await vesselGlb(5, 16, 8, [0.5, 0.5, 0.5]);
    const sin = stlBox(await convert(glb, 'stl', undefined, { heightMm: 60, base: false }));
    const con = stlBox(await convert(glb, 'stl', undefined, { heightMm: 60, base: true }));
    expect(con.n).toBeGreaterThan(sin.n);
    expect(con.min[2]).toBeCloseTo(0, 3);
    expect(con.size[2]).toBeCloseTo(62, 1); // 2 mm de peana + 60 mm de figura
    expect(con.size[0]).toBeGreaterThan(sin.size[0]); // la peana sobresale un poco
  });

  it('3MF con la misma preparación, en milímetros', async () => {
    const out = await convert(await cubeGlb(), '3mf', undefined, { heightMm: 40, base: false });
    const model = strFromU8(unzipSync(new Uint8Array(out))['3D/3dmodel.model']);
    const zs = [...model.matchAll(/ z="([^"]+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(40, 1);
  });

  it('informe: un cubo cerrado es imprimible; un jarrón abierto avisa de bordes abiertos', async () => {
    const cube = await printReport(await cubeGlb(), { heightMm: 40, base: false });
    expect(cube).toMatchObject({ watertight: true, openEdges: 0 });
    expect(cube.sizeMm.z).toBeCloseTo(40, 1);
    const vase = await printReport(await vesselGlb(5, 16, 8, [0.5, 0.5, 0.5]), { heightMm: 60, base: true });
    expect(vase.watertight).toBe(false);
    expect(vase.openEdges).toBeGreaterThan(0);
  });

  it('la API exporta con opciones de impresión, devuelve el informe y no mezcla la caché con el STL normal', async () => {
    const u = await login(env);
    const t = (await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID())
      .send({ type: 'text_to_model', series: 'hd', prompt: 'un jarrón', privacy: 'public', params: PARAMS }).expect(201)).body.task;
    await drain();
    const id = (await env.api().get(`/api/tasks/${t.id}`).set(u.h)).body.task.assetIds[0];
    const plain = (await env.api().post(`/api/assets/${id}/export`).set(u.h).send({ format: 'stl' }).expect(200)).body;
    const ready = (await env.api().post(`/api/assets/${id}/export`).set(u.h).send({ format: 'stl', print: { heightMm: 60, base: true } }).expect(200)).body;
    expect(plain.print).toBeUndefined();
    expect(ready.print).toMatchObject({ heightMm: 60, base: true, watertight: expect.any(Boolean), sizeMm: { z: expect.any(Number) } });
    expect(ready.url).not.toBe(plain.url);
    await env.api().post(`/api/assets/${id}/export`).set(u.h).send({ format: 'stl', print: { heightMm: 2, base: false } }).expect(422);
    await env.api().post(`/api/assets/${id}/export`).set(u.h).send({ format: 'glb', print: { heightMm: 60, base: false } }).expect(422);
  });
});
