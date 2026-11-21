import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { login, makeEnv, type Env } from './helpers.js';

// En los tests los límites se relajan; este fichero activa los reales.
let env: Env;
beforeAll(async () => {
  process.env['TEST_REAL_RATE_LIMITS'] = '1';
  env = await makeEnv();
});
afterAll(async () => {
  delete process.env['TEST_REAL_RATE_LIMITS'];
  await env.app.closeEvents();
  await env.ctx.db.end();
});

it('BUG-005 crear tareas: la petición 31 en un minuto recibe 429', async () => {
  const u = await login(env);
  const codes: number[] = [];
  for (let i = 0; i < 31; i++) {
    // cuerpo inválido a propósito: el límite se aplica antes de validar y no gasta créditos
    codes.push((await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID()).send({})).status);
  }
  expect(codes.slice(0, 30).every((c) => c === 422)).toBe(true);
  expect(codes[30]).toBe(429);
});

it('el límite es por usuario: otro usuario no se ve afectado', async () => {
  const v = await login(env);
  const r = await env.api().post('/api/tasks').set(v.h).set('Idempotency-Key', randomUUID()).send({});
  expect(r.status).toBe(422);
});

it('rutas públicas (planes, packs): límite global por IP de 240 por minuto', async () => {
  const codes: number[] = [];
  for (let i = 0; i < 241; i++) codes.push((await env.api().get('/api/plans').set('X-Forwarded-For', '198.51.100.9')).status);
  expect(codes.slice(0, 240).every((c) => c === 200)).toBe(true);
  expect(codes[240]).toBe(429);
  // otra IP no se ve afectada
  expect((await env.api().get('/api/plans').set('X-Forwarded-For', '198.51.100.10')).status).toBe(200);
});
