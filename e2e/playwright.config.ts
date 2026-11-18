import { defineConfig } from '@playwright/test';

// Contra la app local con la API real (server/.env.local). Arranca lo que no esté ya en marcha.
export default defineConfig({
  testDir: './tests',
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
    { command: 'npm --prefix ../server run dev', url: 'http://localhost:8787/health', reuseExistingServer: true, timeout: 120_000 },
    { command: 'npm --prefix ../web start -- --port 4300', url: 'http://localhost:4300', reuseExistingServer: true, timeout: 180_000 },
  ],
});
