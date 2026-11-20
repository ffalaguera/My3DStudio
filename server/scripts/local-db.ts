// Postgres 17 local para desarrollo, sin Docker (binarios oficiales vía npm). Datos en .pgdata/.
// Uso: npm run db:local   (déjalo abierto; Ctrl+C para pararlo)
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';

const port = Number(process.env['LOCAL_DB_PORT'] ?? 54329);
const db = new EmbeddedPostgres({
  databaseDir: './.pgdata', user: 'postgres', password: 'postgres', port, persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], // como Supabase; sin esto Windows usa WIN1252 (BUG-001)
});
if (!existsSync('./.pgdata/PG_VERSION')) {
  await db.initialise();
}
await db.start();
await db.createDatabase('my3dstudio').catch(() => {}); // ya existe
console.log(`[db] Postgres local en postgres://postgres:postgres@localhost:${port}/my3dstudio`);
const stop = async () => {
  await db.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
