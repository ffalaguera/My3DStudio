import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startWorker } from '../src/jobs/worker.js';
import { login, makeEnv, PARAMS, type Env } from './helpers.js';

let env: Env;
beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => {
  await env.app.closeEvents();
  await env.ctx.db.end();
});

it('el trabajador real arranca, reparte, genera y para (pg-boss + cron)', async () => {
  const worker = await startWorker(env.ctx);
  try {
    const u = await login(env);
    const t = (await env.api().post('/api/tasks').set(u.h).set('Idempotency-Key', randomUUID())
      .send({ type: 'text_to_model', series: 'hd', prompt: 'un cuenco', params: PARAMS, privacy: 'public' }).expect(201)).body.task;
    let status = 'queued';
    for (let i = 0; i < 60 && status !== 'success'; i++) {
      await new Promise((r) => setTimeout(r, 250));
      status = (await env.api().get(`/api/tasks/${t.id}`).set(u.h)).body.task.status;
    }
    expect(status).toBe('success');
    const schedules = await env.ctx.db.query('select name from pgboss.schedule order by name');
    expect(schedules.rows.map((r) => r.name)).toEqual(['cleanup-uploads', 'expire-history', 'grant-free-credits', 'reap-stuck']);
  } finally {
    await worker.stop();
  }
}, 60_000);
