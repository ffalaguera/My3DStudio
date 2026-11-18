import pg from 'pg';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  pool.on('error', (e) => console.error('[db] error en el pool:', e.message));
  return pool;
}

/** Ejecuta fn en una transacción. Reintenta una vez si hay conflicto de serialización o deadlock. */
export async function tx<T>(db: Db, fn: (c: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const c = await db.connect();
    try {
      await c.query('begin');
      const out = await fn(c);
      await c.query('commit');
      return out;
    } catch (e) {
      await c.query('rollback').catch(() => {});
      const code = (e as { code?: string }).code;
      if (attempt === 0 && (code === '40001' || code === '40P01')) continue;
      throw e;
    } finally {
      c.release();
    }
  }
}

/** Avisa a las conexiones SSE de que una tarea de un usuario ha cambiado. */
export async function notifyTask(c: Tx | Db, userId: string, taskId: string): Promise<void> {
  await c.query(`select pg_notify('task_events', $1)`, [JSON.stringify({ userId, taskId })]);
}
