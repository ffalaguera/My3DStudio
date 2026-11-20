import EmbeddedPostgres from 'embedded-postgres';
import { rmSync } from 'node:fs';

const PORT = 54330;
const DIR = './.pgdata-test';

export async function setup() {
  rmSync(DIR, { recursive: true, force: true });
  const db = new EmbeddedPostgres({
    databaseDir: DIR, user: 'postgres', password: 'postgres', port: PORT, persistent: false, onLog: () => {},
    initdbFlags: ['--encoding=UTF8', '--locale=C'], // como Supabase; sin esto Windows usa WIN1252 (BUG-001)
  });
  await db.initialise();
  await db.start();
  await db.createDatabase('my3dstudio_test');
  process.env['TEST_DATABASE_URL'] = `postgres://postgres:postgres@localhost:${PORT}/my3dstudio_test`;
  return async () => {
    await db.stop();
    rmSync(DIR, { recursive: true, force: true });
  };
}
