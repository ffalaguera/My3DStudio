import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeEnv, type Env } from './helpers.js';

// Acceso propio (AUTH_PROVIDER=self): enlace mágico de un solo uso que caduca, sesión por Bearer, sin cookies.
let env: Env;
beforeAll(async () => {
  env = await makeEnv({ realPlans: true, env: { LOCAL_AUTH: '0', AUTH_PROVIDER: 'self', BETTER_AUTH_SECRET: 'b'.repeat(16) + 'R7kq2Lx9Pz4Wm8Nv3Jc6Ty1Hs5Fd0Ga' } });
});
afterAll(async () => {
  await env.app.closeEvents();
  await env.ctx.db.end();
});

const ORIGIN = 'http://localhost:4300';
let n = 0;
const email = () => `acceso-${Date.now()}-${++n}@example.com`;

async function requestLink(addr: string): Promise<string> {
  env.sent.length = 0;
  await env.api().post('/api/auth/sign-in/magic-link').set('Origin', ORIGIN).send({ email: addr }).expect(200);
  const mail = env.sent.find((m) => m.to === addr && m.t.kind === 'magic_link');
  expect(mail, 'se envía el email con el enlace').toBeDefined();
  const url = new URL((mail!.t as { url: string }).url);
  expect(url.origin + url.pathname).toBe(`${ORIGIN}/entrar`); // el enlace lleva a la web, no a la API
  return url.searchParams.get('token')!;
}
const verify = (token: string) => env.api().get('/api/auth/magic-link/verify').query({ token }).set('Origin', ORIGIN).redirects(0);

describe('acceso propio con enlace mágico', () => {
  it('pedir enlace → canjearlo → sesión Bearer que sirve en la API, sin créditos regalados', async () => {
    const addr = email();
    const token = await requestLink(addr);
    const r = await verify(token).expect(200);
    expect(r.body.token).toEqual(expect.any(String));
    const me = await env.api().get('/api/me').set('Authorization', `Bearer ${r.body.token}`).expect(200);
    expect(me.body.profile.email).toBe(addr);
    expect(me.body.credits.available).toBe(0);
  });

  it('el enlace es de un solo uso', async () => {
    const token = await requestLink(email());
    await verify(token).expect(200);
    const again = await verify(token);
    expect(again.status).not.toBe(200);
  });

  it('el enlace caduca (10 minutos)', async () => {
    const token = await requestLink(email());
    await env.ctx.db.query(`update ba_verification set "expiresAt" = now() - interval '1 minute'`);
    expect((await verify(token)).status).not.toBe(200);
  });

  it('el token del enlace se guarda cifrado: el de la base no coincide con el del email', async () => {
    const token = await requestLink(email());
    const rows = (await env.ctx.db.query('select identifier from ba_verification')).rows.map((r) => r.identifier as string);
    expect(rows.some((id) => id.includes(token))).toBe(false);
  });

  it('cerrar sesión la revoca en el servidor', async () => {
    const r = await verify(await requestLink(email())).expect(200);
    const h = { Authorization: `Bearer ${r.body.token}` };
    await env.api().get('/api/me').set(h).expect(200);
    await env.api().post('/api/auth/sign-out').set(h).set('Origin', ORIGIN).send({}).expect(200);
    await env.api().get('/api/me').set(h).expect(401);
  });

  it('tokens inventados: 401', async () => {
    await env.api().get('/api/me').set('Authorization', 'Bearer inventado.x.y').expect(401);
  });

  it('borrar la cuenta elimina también el usuario y sus sesiones de acceso', async () => {
    const addr = email();
    const r = await verify(await requestLink(addr)).expect(200);
    const h = { Authorization: `Bearer ${r.body.token}` };
    await env.api().get('/api/me').set(h).expect(200);
    await env.api().delete('/api/me').set(h).send({ confirm: 'BORRAR' }).expect(202);
    expect((await env.ctx.db.query('select count(*)::int n from ba_user where email = $1', [addr])).rows[0].n).toBe(0);
    await env.api().get('/api/me').set(h).expect(401);
  });

  it('sin LOCAL_AUTH no hay acceso de desarrollo', async () => {
    await env.api().post('/api/dev/login').send({ email: email() }).expect(404);
  });
});
