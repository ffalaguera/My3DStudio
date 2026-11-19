import { loadConfig } from './config.js';
import { createApp, createCtx } from './app.js';
import { migrate } from './migrate.js';
import { startWorker } from './jobs/worker.js';

const cfg = loadConfig();
const ctx = createCtx(cfg);
await waitForDb();
await migrate(ctx.db, { local: cfg.LOCAL_AUTH, log: (m) => console.log(`[db] ${m}`) });

/** Si la base aún está arrancando (o reiniciándose), espera hasta 60 s en vez de caerse. */
async function waitForDb(): Promise<void> {
  const transient = new Set(['57P03', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT']);
  for (let i = 1; ; i++) {
    try {
      await ctx.db.query('select 1');
      return;
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      if (!transient.has(code) || i >= 30) throw e;
      console.log(`[db] esperando a la base de datos (${code}), intento ${i}/30`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
const app = createApp(ctx);
const server = app.listen(cfg.PORT, () => console.log(`[api] escuchando en ${cfg.PUBLIC_API_URL} (${cfg.NODE_ENV})`));
const worker = cfg.RUN_WORKER ? await startWorker(ctx) : null;
if (worker) console.log('[worker] en marcha');

async function shutdown() {
  server.close();
  await app.closeEvents();
  await worker?.stop();
  await ctx.db.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
