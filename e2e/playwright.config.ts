import { defineConfig } from '@playwright/test';

// Contra la app local con la API de DEMOSTRACIÓN (motor falso, sin coste). Arranca lo que no esté ya en marcha.
// global-setup.ts se niega a seguir si la API en marcha usa el motor real de pago.
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: 'http://localhost:4300',
    channel: 'msedge', // Edge instalado en el equipo: no hace falta descargar Chromium
    viewport: { width: 1440, height: 900 },
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    { command: 'npm --prefix ../server run db:local', port: 54329, reuseExistingServer: true, timeout: 120_000 },
    { command: 'npm --prefix ../server run dev:demo', url: 'http://localhost:8787/health', reuseExistingServer: true, timeout: 120_000,
      env: { GENERATION_PROVIDER: 'fake' } },
    { command: 'npm --prefix ../web start -- --port 4300', url: 'http://localhost:4300', reuseExistingServer: true, timeout: 180_000 },
  ],
});
