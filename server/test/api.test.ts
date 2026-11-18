import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createProvider, dispatch, reapStuck, runGeneration, grantFreeCredits } from '../src/jobs/worker.js';
import { credits, login, makeEnv, PARAMS, uploadImage, type Env } from './helpers.js';

let env: Env;
beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => {
  await env.app.closeEvents();
  await env.ctx.db.end();
});

/** Ejecuta la cola como el trabajador: reparte y genera hasta que no quede nada en marcha. */
async function drain() {
  const provider = createProvider(env.ctx);
  for (let i = 0; i < 20; i++) {
    const ids = await dispatch(env.ctx);
    if (!ids.length) return;
    await Promise.all(ids.map((id) => runGeneration(env.ctx, provider, id)));
  }
}

const textTask = (prompt: string, extra: object = {}) => ({ type: 'text_to_model', series: 'hd', prompt, params: PARAMS, privacy: 'public', ...extra });

describe('auth', () => {
  it('sin token o con token falso: 401', async () => {
    await env.api().get('/api/me').expect(401);
    await env.api().get('/api/me').set('Authorization', 'Bearer abc.def.ghi').expect(401);
  });

  it('el primer acceso crea perfil y 200 créditos de bienvenida', async () => {
    const u = await login(env);
    expect(await credits(env, u.h)).toMatchObject({ available: 200, frozen: 0, monthly: 200 });
    const ledger = (await env.api().get('/api/credits/ledger').set(u.h).expect(200)).body.entries;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ reason: 'grant', delta: 200 });
  });
});

describe('generación y créditos', () => {
  it('imagen → tarea → modelo: congela, consume y deja el GLB descargable', async () => {
    const u = await login(env);
    const uploadId = await uploadImage(env, u.h);
    const t = (await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID())
      .send({ type: 'image_to_model', series: 'hd', uploadId, params: PARAMS, privacy: 'public' }).expect(201)).body.task;
    expect(t.status).toBe('queued');
    expect(await credits(env, u.h)).toMatchObject({ available: 185, frozen: 15 });
    await drain();
    const done = (await env.api().get(`/api/tasks/${t.id}`).set(u.h).expect(200)).body.task;
    expect(done).toMatchObject({ status: 'success', progress: 100 });
    expect(done.assetIds).toHaveLength(1);
    expect(await credits(env, u.h)).toMatchObject({ available: 185, frozen: 0 });
    const asset = (await env.api().get(`/api/assets/${done.assetIds[0]}`).set(u.h).expect(200)).body.asset;
    expect(asset).toMatchObject({ name: 'jarron', series: 'hd', privacy: 'public', license: 'attribution' });
    expect(asset.faceCount).toBeGreaterThan(10000);
    expect(asset.expiresAt).toBeTruthy(); // historial de 1 día en Gratis
    const glbUrl = new URL(asset.glbUrl);
    const glb = await env.api().get(glbUrl.pathname + glbUrl.search).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect((glb.body as Buffer).subarray(0, 4).toString('ascii')).toBe('glTF');
  });

  it('el mismo Idempotency-Key no crea ni cobra dos veces', async () => {
    const u = await login(env);
    const key = randomUUID();
    const a = (await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', key).send(textTask('una silla')).expect(201)).body.task;
    const b = (await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', key).send(textTask('una silla')).expect(201)).body.task;
    expect(b.id).toBe(a.id);
    expect(await credits(env, u.h)).toMatchObject({ available: 185, frozen: 15 });
  });

  it('si la generación falla se devuelven los créditos', async () => {
    const u = await login(env);
    const t = (await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID()).send(textTask('una lámpara fallo')).expect(201)).body.task;
    await drain();
    const f = (await env.api().get(`/api/tasks/${t.id}`).set(u.h)).body.task;
    expect(f.status).toBe('failed');
    expect(f.errorMessage).toMatch(/no ha podido/);
    expect(await credits(env, u.h)).toMatchObject({ available: 200, frozen: 0 });
    const reasons = (await env.api().get('/api/credits/ledger').set(u.h)).body.entries.map((e: { reason: string }) => e.reason);
    expect(reasons.filter((r: string) => r === 'release')).toHaveLength(1);
  });

  it('plan Gratis: 1 tarea a la vez; la segunda espera en cola y se puede cancelar', async () => {
    const u = await login(env);
    const a = (await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID()).send(textTask('una mesa')).expect(201)).body.task;
    const b = (await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID()).send(textTask('una silla')).expect(201)).body.task;
    const started = await dispatch(env.ctx);
    expect(started).toContain(a.id);
    expect(started).not.toContain(b.id);
    const queued = (await env.api().get(`/api/tasks/${b.id}`).set(u.h)).body.task;
    expect(queued).toMatchObject({ status: 'queued', queuePosition: 1 });
    await env.api().delete(`/api/tasks/${a.id}`).set(u.h).expect(409); // en curso: no se cancela
    await env.api().delete(`/api/tasks/${b.id}`).set(u.h).expect(200);
    expect(await credits(env, u.h)).toMatchObject({ available: 185, frozen: 15 });
    await env.api().delete(`/api/tasks/${b.id}`).set(u.h).expect(409); // no se devuelve dos veces
    await runGeneration(env.ctx, createProvider(env.ctx), a.id);
    expect(await credits(env, u.h)).toMatchObject({ available: 185, frozen: 0 });
  });

  it('20 peticiones a la vez con saldo para 13: se crean 13, el resto 402, el saldo nunca es negativo', async () => {
    const u = await login(env);
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID()).send(textTask(`pieza ${i}`))));
    expect(res.filter((r) => r.status === 201)).toHaveLength(13);
    expect(res.filter((r) => r.status === 402)).toHaveLength(7);
    expect(await credits(env, u.h)).toMatchObject({ available: 5, frozen: 195 });
  });

  it('avisos de plan y créditos', async () => {
    const u = await login(env);
    const smart = await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID())
      .send(textTask('una caja', { series: 'smart' })).expect(403);
    expect(smart.body.error.code).toBe('plan_feature');
    await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID()).send(textTask('una caja', { privacy: 'private' })).expect(403);
    await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID())
      .send(textTask('una caja', { params: { ...PARAMS, textureResolution: '8k' } })).expect(403);
    await env.ctx.db.query('update credit_accounts set monthly_balance = 10 where user_id = $1', [u.id]);
    const poor = await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID()).send(textTask('una caja')).expect(402);
    expect(poor.body.error).toMatchObject({ code: 'insufficient_credits', message: 'Te faltan 5 créditos' });
    const est = (await env.api().post('/api/tasks/estimate').set(u.h).send(textTask('una caja'))).body;
    expect(est).toMatchObject({ allowed: false, reason: 'insufficient_credits', credits: 15 });
  });

  it('BUG-001 emoji y caracteres fuera de Latin-1 en el prompt y el nombre (base en UTF-8)', async () => {
    const u = await login(env);
    const t = await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID())
      .send(textTask('🦊 zorro de cerámica, ñ, 東京')).expect(201);
    await drain();
    const id = (await env.api().get(`/api/tasks/${t.body.task.id}`).set(u.h)).body.task.assetIds[0];
    expect((await env.api().get(`/api/assets/${id}`).set(u.h)).body.asset.name).toBe('🦊 zorro de cerámica, ñ, 東京');
  });

  it('validación: texto sin prompt, imagen sin subida, campos de más', async () => {
    const u = await login(env);
    await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID()).send(textTask('')).expect(422);
    await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID())
      .send({ type: 'image_to_model', series: 'hd', params: PARAMS }).expect(422);
    await env.api().post('/api/tasks').set(u.h).send(textTask('sin clave')).expect(422);
    await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID())
      .send(textTask('x', { params: { ...PARAMS, faceLimit: 999999 } })).expect(422);
  });

  it('tareas atascadas: se marcan fallidas y se devuelven los créditos', async () => {
    const u = await login(env);
    const t = (await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID()).send(textTask('una jarra')).expect(201)).body.task;
    await env.ctx.db.query(`update tasks set status = 'running', started_at = now() - interval '2 hours' where id = $1`, [t.id]);
    expect(await reapStuck(env.ctx)).toBeGreaterThanOrEqual(1);
    expect((await env.api().get(`/api/tasks/${t.id}`).set(u.h)).body.task.status).toBe('failed');
    expect(await credits(env, u.h)).toMatchObject({ available: 200, frozen: 0 });
  });

  it('renovación mensual: caduca lo que quede y concede 200; una devolución tardía de otro ciclo caduca', async () => {
    const u = await login(env);
    const t = (await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID()).send(textTask('una taza fallo')).expect(201)).body.task;
    // la tarea se congeló en un ciclo que acaba de terminar
    await env.ctx.db.query(`update credit_accounts set monthly_cycle_ends_at = now() - interval '1 minute' where user_id = $1`, [u.id]);
    await env.ctx.db.query(`update tasks set frozen_cycle_ends_at = now() - interval '1 minute' where id = $1`, [t.id]);
    await grantFreeCredits(env.ctx);
    expect(await credits(env, u.h)).toMatchObject({ available: 200, frozen: 15 });
    await drain(); // falla: los 15 del ciclo anterior no vuelven
    expect(await credits(env, u.h)).toMatchObject({ available: 200, frozen: 0 });
    void t;
  });
});

describe('aislamiento entre usuarios', () => {
  it('un segundo usuario no ve ni toca nada del primero', async () => {
    const a = await login(env, 'ana');
    const b = await login(env, 'beto');
    const uploadId = await uploadImage(env, a.h);
    const t = (await env.api().post('/api/tasks').set(a.h).set('Idempotency-Key', randomUUID())
      .send({ type: 'image_to_model', series: 'hd', uploadId, params: PARAMS, privacy: 'public' }).expect(201)).body.task;
    await drain();
    const assetId = (await env.api().get(`/api/tasks/${t.id}`).set(a.h)).body.task.assetIds[0];

    await env.api().get(`/api/tasks/${t.id}`).set(b.h).expect(404);
    await env.api().delete(`/api/tasks/${t.id}`).set(b.h).expect(404);
    await env.api().post(`/api/tasks/${t.id}/retry`).set(b.h).set('Idempotency-Key', randomUUID()).expect(404);
    await env.api().get(`/api/assets/${assetId}`).set(b.h).expect(404);
    await env.api().patch(`/api/assets/${assetId}`).set(b.h).send({ name: 'mío' }).expect(404);
    await env.api().post(`/api/assets/${assetId}/export`).set(b.h).send({ format: 'glb' }).expect(404);
    await env.api().delete(`/api/assets/${assetId}`).set(b.h).expect(404);
    await env.api().post(`/api/uploads/${uploadId}/complete`).set(b.h).expect(404);
    // usar la imagen de otro como entrada
    await env.api().post('/api/tasks').set(b.h).set('Idempotency-Key', randomUUID())
      .send({ type: 'image_to_model', series: 'hd', uploadId, params: PARAMS, privacy: 'public' }).expect(422);
    expect((await env.api().get('/api/tasks').set(b.h)).body.tasks).toHaveLength(0);
    expect((await env.api().get('/api/assets').set(b.h)).body.assets).toHaveLength(0);
    // y lo de A sigue intacto
    expect((await env.api().get(`/api/assets/${assetId}`).set(a.h).expect(200)).body.asset.name).toBe('jarron');
  });
});

describe('subidas y archivos firmados', () => {
  it('rechaza firmas manipuladas, tipos distintos y archivos que no son imagen', async () => {
    const u = await login(env);
    const r = (await env.api().post('/api/uploads').set(u.h).send({ kind: 'image', contentType: 'image/png', sizeBytes: 64 }).expect(201)).body;
    const url = new URL(r.putUrl);
    const bad = url.pathname + url.search.replace(/sig=[^&]+/, 'sig=manipulada');
    await env.api().put(bad).set('Content-Type', 'image/png').send(Buffer.alloc(64)).expect(403);
    await env.api().put(url.pathname + url.search).set('Content-Type', 'image/jpeg').send(Buffer.alloc(64)).expect(415);
    await env.api().put(url.pathname + url.search).set('Content-Type', 'image/png').send(Buffer.alloc(64)).expect(200);
    const c = await env.api().post(`/api/uploads/${r.uploadId}/complete`).set(u.h).expect(422);
    expect(c.body.error.code).toBe('invalid_image');
    await env.api().post('/api/uploads').set(u.h).send({ kind: 'image', contentType: 'image/png', sizeBytes: 30 * 1024 * 1024 }).expect(413);
    await env.api().post('/api/uploads').set(u.h).send({ kind: 'image', contentType: 'image/gif', sizeBytes: 100 }).expect(422);
    await env.api().get('/files/u/../../etc/passwd?exp=9999999999&sig=x').expect((res) => expect([403, 404]).toContain(res.status));
  });

  it('imagen demasiado pequeña', async () => {
    const u = await login(env);
    await expect(uploadImage(env, u.h, 'mini.png', 100)).rejects.toThrow();
  });
});

describe('exportar', () => {
  it('OBJ y STL se convierten; FBX sin Blender da 501 y no cuenta; el límite del plan Gratis se respeta', async () => {
    const u = await login(env);
    const t = (await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID()).send(textTask('un vaso')).expect(201)).body.task;
    await drain();
    const id = (await env.api().get(`/api/tasks/${t.id}`).set(u.h)).body.task.assetIds[0];
    const obj = (await env.api().post(`/api/assets/${id}/export`).set(u.h).send({ format: 'obj' }).expect(200)).body;
    expect(obj.filename).toBe('un-vaso.obj');
    const stl = (await env.api().post(`/api/assets/${id}/export`).set(u.h).send({ format: 'stl' }).expect(200)).body;
    const s = new URL(stl.url);
    const res = await env.api().get(s.pathname + s.search).expect(200);
    expect(res.headers['content-disposition']).toMatch(/modelo-[0-9a-f]{8}.stl/);
    await env.api().post(`/api/assets/${id}/export`).set(u.h).send({ format: 'fbx' }).expect(501);
    expect((await env.api().get('/api/me').set(u.h)).body.usage.exportsThisMonth).toBe(2);
    await env.ctx.db.query(`insert into exports (user_id, asset_id, format) select $1, $2, 'glb' from generate_series(1, 13)`, [u.id, id]);
    const lim = await env.api().post(`/api/assets/${id}/export`).set(u.h).send({ format: 'glb' }).expect(403);
    expect(lim.body.error.code).toBe('export_limit');
  });

  it('privado solo en planes de pago; renombrar valida el nombre', async () => {
    const u = await login(env);
    const t = (await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID()).send(textTask('un plato')).expect(201)).body.task;
    await drain();
    const id = (await env.api().get(`/api/tasks/${t.id}`).set(u.h)).body.task.assetIds[0];
    await env.api().patch(`/api/assets/${id}`).set(u.h).send({ privacy: 'private' }).expect(403);
    await env.api().patch(`/api/assets/${id}`).set(u.h).send({ name: '   ' }).expect(422);
    const ok = await env.api().patch(`/api/assets/${id}`).set(u.h).send({ name: 'Plato hondo' }).expect(200);
    expect(ok.body.asset.name).toBe('Plato hondo');
    expect((await env.api().get('/api/assets?q=hondo').set(u.h)).body.assets).toHaveLength(1);
    expect((await env.api().get('/api/assets?q=100%25').set(u.h)).body.assets).toHaveLength(0);
  });
});

describe('borrar la cuenta', () => {
  it('borra filas y archivos y el token deja de valer', async () => {
    const u = await login(env);
    await uploadImage(env, u.h);
    await env.api().delete('/api/me').set(u.h).send({}).expect(422); // hace falta la confirmación
    await env.api().delete('/api/me').set(u.h).send({ confirm: 'BORRAR' }).expect(202);
    for (const table of ['profiles', 'credit_accounts', 'credit_ledger', 'uploads', 'tasks', 'assets']) {
      const col = table === 'profiles' ? 'id' : 'user_id';
      expect(Number((await env.ctx.db.query(`select count(*) from ${table} where ${col} = $1`, [u.id])).rows[0].count)).toBe(0);
    }
    await env.api().get('/api/me').set(u.h).expect(401);
    expect(env.sent.some((m) => m.to === u.email && m.t.kind === 'account_deleted')).toBe(true);
  });
});
