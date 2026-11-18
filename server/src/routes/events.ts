import { Router, type Response } from 'express';
import pg from 'pg';
import type { Ctx } from '../context.js';
import * as ser from '../lib/serialize.js';

/**
 * GET /api/events: canal SSE por usuario. Cuando el trabajador cambia una tarea hace pg_notify;
 * aquí se escucha con LISTEN y se envía la tarea actualizada solo a las conexiones de su dueño.
 * El cliente lo lee con fetch (para poder mandar el Bearer); si se corta, vuelve a consultar GET /tasks.
 */
export function eventRoutes(ctx: Ctx) {
  const r = Router();
  const clients = new Map<string, Set<Response>>();
  let listener: pg.Client | null = null;

  async function listen() {
    if (listener) return;
    listener = new pg.Client({ connectionString: ctx.cfg.DATABASE_URL });
    listener.on('error', () => {
      listener = null;
      setTimeout(() => void listen().catch(() => {}), 2000);
    });
    await listener.connect();
    await listener.query('listen task_events');
    listener.on('notification', async (n) => {
      try {
        const { userId, taskId } = JSON.parse(n.payload ?? '{}');
        const set = clients.get(userId);
        if (!set?.size) return;
        const [task] = await ser.tasks(ctx.db, ctx.storage, 't.id = $1 and t.user_id = $2', [taskId, userId]);
        if (!task) return;
        const msg = `event: task\ndata: ${JSON.stringify(task)}\n\n`;
        for (const res of set) res.write(msg);
      } catch (e) {
        console.error('[sse] notificación no válida:', (e as Error).message);
      }
    });
  }

  r.get('/', async (req, res) => {
    await listen();
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    const id = req.user!.id;
    const set = clients.get(id) ?? new Set();
    set.add(res);
    clients.set(id, set);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      set.delete(res);
      if (!set.size) clients.delete(id);
    });
  });

  return Object.assign(r, {
    async close() {
      for (const set of clients.values()) for (const res of set) res.end();
      clients.clear();
      await listener?.end().catch(() => {});
      listener = null;
    },
  });
}
