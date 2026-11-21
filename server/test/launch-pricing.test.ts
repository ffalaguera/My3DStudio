import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

// Tarifa de lanzamiento (replica/launch/pricing.md): un modelo cuesta 50 créditos (~0,50 € a precio de pack).
describe('tarifa de lanzamiento', () => {
  it('los costes por defecto cubren el coste del motor (fal ≈ 0,28 € por modelo)', () => {
    const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x', LOCAL_AUTH: '1', LOCAL_JWT_SECRET: 'x'.repeat(40), FILE_URL_SECRET: 'y'.repeat(40) });
    expect(cfg).toMatchObject({ CREDITS_HD: 50, CREDITS_SMART_PER_VARIANT: 50, CREDITS_TEXTURE_4K: 10, CREDITS_TEXTURE_8K: 20 });
  });
});
