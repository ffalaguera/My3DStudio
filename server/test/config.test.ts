import { expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = {
  DATABASE_URL: 'postgres://x', LOCAL_AUTH: '1', LOCAL_JWT_SECRET: 'x'.repeat(40), FILE_URL_SECRET: 'y'.repeat(40),
};

it('las variables vacías de .env.example cuentan como no definidas', () => {
  const c = loadConfig({ ...base, FAL_KEY: '', FAL_BASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' });
  expect(c.FAL_BASE_URL).toBeUndefined();
  expect(c.GENERATION_PROVIDER).toBe('fake');
});

it('fal exige FAL_KEY; el motor falso no vale en producción', () => {
  expect(() => loadConfig({ ...base, GENERATION_PROVIDER: 'fal' })).toThrow(/FAL_KEY/);
  expect(() => loadConfig({ ...base, GENERATION_PROVIDER: 'fal', FAL_KEY: '' })).toThrow(/FAL_KEY/);
  expect(() => loadConfig({ ...base, NODE_ENV: 'production', LOCAL_AUTH: '0', SUPABASE_URL: 'https://p.supabase.co',
    STORAGE_DRIVER: 'r2', R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'd' }))
    .toThrow(/motor falso/);
});

it('claves live de Stripe fuera de producción: no', () => {
  expect(() => loadConfig({ ...base, STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' })).toThrow(/sk_test_/);
});
