import { loadConfig } from './config.js';
import { createApp, createCtx } from './app.js';
import { migrate } from './migrate.js';
import { startWorker } from './jobs/worker.js';

const cfg = loadConfig();
const ctx = createCtx(cfg);
await migrate(ctx.db, { local: cfg.LOCAL_AUTH, log: (m) => console.log(`[db] ${m}`) });
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
