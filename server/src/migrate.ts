import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Aplica en orden las migraciones SQL pendientes, cada una en su transacción. */
export async function migrate(db: Db, opts: { local: boolean; log?: (m: string) => void }): Promise<string[]> {
  const log = opts.log ?? (() => {});
  await db.query(`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
  const files = [
    ...(opts.local ? readdirSync(join(dir, 'local')).map((f) => `local/${f}`) : []),
    ...readdirSync(dir).filter((f) => f.endsWith('.sql')),
  ].sort((a, b) => a.replace('local/', '').localeCompare(b.replace('local/', '')));
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    const c = await db.connect();
    try {
      await c.query('begin');
      await c.query(sql);
      await c.query('insert into schema_migrations (name) values ($1)', [f]);
      await c.query('commit');
      applied.push(f);
      log(`aplicada ${f}`);
    } catch (e) {
      await c.query('rollback');
      throw new Error(`Falló la migración ${f}: ${(e as Error).message}`);
    } finally {
      c.release();
    }
  }
  return applied;
}
