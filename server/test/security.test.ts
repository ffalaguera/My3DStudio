import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';
import { SignJWT } from 'jose';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createSecurityLog } from '../src/lib/security-log.js';
import { login, makeEnv, WEBHOOK_SECRET, type Env } from './helpers.js';

let env: Env;
const lines: Record<string, unknown>[] = [];

beforeAll(async () => {
  env = await makeEnv();
  // registro de seguridad que guarda en memoria para poder comprobarlo
  env.ctx.security = createSecurityLog({ sink: (e) => void lines.push(e), threshold: 5 });
});
afterAll(async () => {
  await env.app.closeEvents();
  await env.ctx.db.end();
});
const api = () => request(createApp(env.ctx));
const seen = (kind: string) => lines.filter((l) => l['sec'] === kind);

describe('cabeceras y CORS', () => {
  it('cabeceras de seguridad en todas las respuestas y sin X-Powered-By', async () => {
    const r = await api().get('/health').expect(200);
    expect(r.headers['strict-transport-security']).toMatch(/max-age=31536000; includeSubDomains/);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });

  it('las respuestas con datos del usuario no se guardan en caché', async () => {
    const u = await login(env);
    expect((await api().get('/api/me').set(u.h).expect(200)).headers['cache-control']).toBe('no-store');
  });

  it('CORS: solo el origen de la app; otro origen no recibe permiso', async () => {
    const ok = await api().options('/api/me').set('Origin', 'http://localhost:4300').set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:4300');
    const evil = await api().options('/api/me').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    expect(evil.headers['access-control-allow-credentials']).toBeUndefined(); // sin cookies: no hay CSRF posible
  });
});

describe('autenticación', () => {
  const secret = new TextEncoder().encode('x'.repeat(40));
  const forge = (opts: { key?: Uint8Array; exp?: string; iss?: string; aud?: string } = {}) =>
    new SignJWT({ email: 'ataque@example.com' }).setProtectedHeader({ alg: 'HS256' }).setSubject('00000000-0000-0000-0000-000000000001')
      .setIssuer(opts.iss ?? 'local-dev').setAudience(opts.aud ?? 'authenticated').setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(opts.exp ?? '2h').sign(opts.key ?? secret);

  it('rechaza: sin token, token de otra clave, caducado, emisor o audiencia falsos y alg none', async () => {
    await api().get('/api/me').expect(401);
    await api().get('/api/me').set('Authorization', `Bearer ${await forge({ key: new TextEncoder().encode('z'.repeat(40)) })}`).expect(401);
    await api().get('/api/me').set('Authorization', `Bearer ${await forge({ exp: '1h' })}`).expect(401); // emitido hace 2 h
    await api().get('/api/me').set('Authorization', `Bearer ${await forge({ iss: 'https://evil.example' })}`).expect(401);
    await api().get('/api/me').set('Authorization', `Bearer ${await forge({ aud: 'service_role' })}`).expect(401);
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'x', email: 'a@b.c', iss: 'local-dev', aud: 'authenticated' })).toString('base64url')}.`;
    await api().get('/api/me').set('Authorization', `Bearer ${none}`).expect(401);
  });

  it('los intentos fallidos se registran y, al pasar el umbral, saltan una sola alerta', async () => {
    lines.length = 0;
    for (let i = 0; i < 7; i++) await api().get('/api/assets').set('Authorization', 'Bearer basura').set('X-Forwarded-For', '203.0.113.77').expect(401);
    expect(seen('auth_failed').length).toBe(7);
    expect(seen('auth_failed')[0]).toMatchObject({ ip: '203.0.113.0', path: '/api/assets' }); // IP recortada (RGPD)
    expect(seen('alert')).toHaveLength(1);
    expect(seen('alert')[0]).toMatchObject({ kind: 'auth_failed', ip: '203.0.113.0' });
  });

  it('las rutas de desarrollo no existen sin LOCAL_AUTH (no hay rutas de administración expuestas)', async () => {
    const cfg = { ...env.cfg, LOCAL_AUTH: false, SUPABASE_URL: 'https://proyecto.supabase.co' };
    await request(createApp({ ...env.ctx, cfg })).post('/api/dev/login').send({ email: 'a@b.c' }).expect(404);
  });
});

describe('entradas', () => {
  it('JSON mal formado: 400, no 500', async () => {
    const u = await login(env);
    const r = await api().post('/api/tasks').set(u.h).set('Content-Type', 'application/json').send('{"type": ');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('bad_json');
  });

  it('cuerpo enorme: 413', async () => {
    const u = await login(env);
    await api().post('/api/tasks').set(u.h).send({ prompt: 'x'.repeat(200_000) }).expect(413);
  });

  it('inyección SQL en la búsqueda: se trata como texto', async () => {
    const u = await login(env);
    const r = await api().get('/api/assets').query({ q: "' or 1=1; drop table assets; --" }).set(u.h).expect(200);
    expect(r.body.assets).toEqual([]);
    expect((await env.ctx.db.query('select count(*) from assets')).rows[0].count).toBeDefined(); // la tabla sigue ahí
  });

  it('un id que no es UUID: 422, sin tocar la base', async () => {
    const u = await login(env);
    await api().get("/api/assets/1' or '1'='1").set(u.h).expect(422);
  });
});

describe('pagos', () => {
  const stripe = new Stripe('sk_test_solo_para_firmas');
  const send = (type: string, object: object, sig?: string) => {
    const payload = JSON.stringify({ id: `evt_sec_${Math.random()}`, object: 'event', type, data: { object }, api_version: '2024-12-18.acacia', created: 0, livemode: false });
    return api().post('/api/webhooks/stripe').set('Content-Type', 'application/json')
      .set('Stripe-Signature', sig ?? stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })).send(payload);
  };

  it('webhook con firma falsa: 400 y queda registrado', async () => {
    lines.length = 0;
    await send('checkout.session.completed', {}, 't=1,v1=falsa').expect(400);
    expect(seen('bad_signature')).toHaveLength(1);
  });

  it('un pack cuyo importe cobrado no coincide con el precio no suma créditos', async () => {
    const u = await login(env);
    const r = await send('checkout.session.completed', {
      id: 'cs_sec', object: 'checkout.session', mode: 'payment', payment_status: 'paid', amount_total: 100, currency: 'eur',
      client_reference_id: u.id, metadata: { user_id: u.id, pack_id: 'pack_9000' },
    }).expect(200);
    expect(r.body.result).toBe('ignored');
    expect(seen('payment_mismatch')).toHaveLength(1);
    const me = (await api().get('/api/me').set(u.h)).body.credits;
    expect(me.permanent).toBe(0);
  });

  it('el coste de una generación lo calcula el servidor: un "credits" enviado por el cliente se ignora o se rechaza', async () => {
    const u = await login(env);
    const r = await api().post('/api/tasks/estimate').set(u.h).send({
      type: 'text_to_model', series: 'hd', prompt: 'una caja', privacy: 'public', credits: 0,
      params: { textureResolution: '2k', pbr: true, texture: true, topology: 'quad', faceLimit: 2000, variants: 1 },
    });
    expect([200, 422]).toContain(r.status);
    if (r.status === 200) expect(r.body.credits).toBe(15);
  });
});

describe('HTTPS y configuración de producción', () => {
  it('en producción, una petición por HTTP se redirige a HTTPS', async () => {
    const cfg = { ...env.cfg, NODE_ENV: 'production' as const, PUBLIC_API_URL: 'https://api.example.com' };
    const r = await request(createApp({ ...env.ctx, cfg })).get('/api/plans').set('X-Forwarded-Proto', 'http').set('Host', 'api.example.com');
    expect(r.status).toBe(308);
    expect(r.headers['location']).toBe('https://api.example.com/api/plans');
    await request(createApp({ ...env.ctx, cfg })).get('/health').set('X-Forwarded-Proto', 'http').expect(200); // el healthcheck interno sigue
  });

  const prod = {
    NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@db.example.com:5432/x?sslmode=require', APP_URL: 'https://app.example.com',
    PUBLIC_API_URL: 'https://api.example.com', SUPABASE_URL: 'https://p.supabase.co', STORAGE_DRIVER: 'r2', R2_ACCOUNT_ID: 'a',
    R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'd', GENERATION_PROVIDER: 'fal', FAL_KEY: 'k',
  };
  it('una configuración de producción correcta carga', () => {
    expect(() => loadConfig(prod)).not.toThrow();
  });
  it.each([
    ['APP_URL sin https', { APP_URL: 'http://app.example.com' }, /APP_URL/],
    ['API sin https', { PUBLIC_API_URL: 'http://api.example.com' }, /PUBLIC_API_URL/],
    ['base de datos sin SSL', { DATABASE_URL: 'postgres://u:p@db.example.com:5432/x' }, /sslmode/],
    ['acceso local', { LOCAL_AUTH: '1', LOCAL_JWT_SECRET: 'x'.repeat(40) }, /LOCAL_AUTH/],
    ['Stripe de pruebas en producción', { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }, /sk_live_/],
  ])('producción rechaza: %s', (_n, extra, msg) => {
    expect(() => loadConfig({ ...prod, ...extra })).toThrow(msg);
  });
});

describe('registro de seguridad', () => {
  it('recorta las IP: IPv4 a /24 e IPv6 a /48, sin guardar la dirección completa', async () => {
    const { maskIp } = await import('../src/lib/security-log.js');
    expect(maskIp('203.0.113.77')).toBe('203.0.113.0');
    expect(maskIp('::ffff:203.0.113.77')).toBe('203.0.113.0');
    expect(maskIp('2001:db8:1:2::5')).toBe('2001:db8:1::/48');
    expect(maskIp('2001:db8::')).toBe('2001:db8:0::/48');
    expect(maskIp('::1')).toBe('::1');
  });
});
