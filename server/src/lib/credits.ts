import type { Db, Tx } from '../db.js';
import { HttpError } from './http.js';

export interface PlanRow {
  id: string;
  name: string;
  price_month_cents: number;
  price_year_cents: number;
  currency: string;
  monthly_credits: number;
  max_concurrent_tasks: number;
  max_batch_size: number;
  max_variants: number;
  monthly_export_limit: number | null;
  max_saved_models: number | null;
  history_days: number | null;
  free_retries: number | null;
  max_texture_resolution: '2k' | '4k' | '8k';
  allow_private: boolean;
  allow_commercial: boolean;
  allow_smart_mesh: boolean;
  stripe_price_month_id: string | null;
  stripe_price_year_id: string | null;
}

export async function planOf(c: Tx | Db, userId: string): Promise<PlanRow> {
  const r = await c.query<PlanRow>('select p.* from plans p join profiles u on u.plan_id = p.id where u.id = $1', [userId]);
  if (!r.rowCount) throw new HttpError(401, 'not_signed_in', 'Inicia sesión para continuar');
  return r.rows[0];
}

/** Tabla de costes en créditos (de la configuración). PROVISIONAL: se ajusta al coste real del motor. */
export interface CreditCosts { hd: number; texture4k: number; texture8k: number; smartPerVariant: number }
let COSTS: CreditCosts = { hd: 15, texture4k: 10, texture8k: 20, smartPerVariant: 100 };
export function setCreditCosts(c: CreditCosts): void {
  COSTS = c;
}

export function costOf(series: 'hd' | 'smart', p: { texture: boolean; textureResolution: '2k' | '4k' | '8k'; variants: number }): number {
  if (series === 'smart') return COSTS.smartPerVariant * p.variants;
  return COSTS.hd + (p.texture ? { '2k': 0, '4k': COSTS.texture4k, '8k': COSTS.texture8k }[p.textureResolution] : 0);
}

interface Account {
  monthly_balance: number;
  permanent_balance: number;
  frozen_monthly: number;
  frozen_permanent: number;
  monthly_cycle_ends_at: Date | null;
}

async function lockAccount(c: Tx, userId: string): Promise<Account> {
  const r = await c.query<Account>('select * from credit_accounts where user_id = $1 for update', [userId]);
  if (!r.rowCount) throw new HttpError(401, 'not_signed_in', 'Inicia sesión para continuar');
  return r.rows[0];
}

/** Congela `cost` créditos para una tarea: primero la bolsa mensual, después la permanente. */
export async function freeze(c: Tx, userId: string, taskId: string, cost: number): Promise<void> {
  if (cost === 0) return;
  const a = await lockAccount(c, userId);
  const available = a.monthly_balance + a.permanent_balance;
  if (available < cost) throw new HttpError(402, 'insufficient_credits', `Te faltan ${cost - available} créditos`);
  const m = Math.min(a.monthly_balance, cost);
  const p = cost - m;
  await c.query(
    `update credit_accounts set monthly_balance = monthly_balance - $2, permanent_balance = permanent_balance - $3,
       frozen_monthly = frozen_monthly + $2, frozen_permanent = frozen_permanent + $3 where user_id = $1`,
    [userId, m, p],
  );
  const note = `Reserva para la tarea ${taskId.slice(0, 8)}`;
  if (m) await c.query(`insert into credit_ledger (user_id, bucket, delta, reason, task_id, note) values ($1,'monthly',$2,'freeze',$3,$4)`, [userId, -m, taskId, note]);
  if (p) await c.query(`insert into credit_ledger (user_id, bucket, delta, reason, task_id, note) values ($1,'permanent',$2,'freeze',$3,$4)`, [userId, -p, taskId, note]);
  await c.query('update tasks set frozen_cycle_ends_at = $2 where id = $1', [taskId, a.monthly_cycle_ends_at]);
}

/**
 * Cierra los créditos congelados de una tarea: `consume` si salió bien, `release` si falló o se canceló.
 * Idempotente: si ya se cerró, no hace nada (índices únicos en credit_ledger lo garantizan además).
 */
export async function settle(c: Tx, userId: string, taskId: string, outcome: 'consume' | 'release'): Promise<void> {
  const a = await lockAccount(c, userId);
  const rows = await c.query<{ bucket: 'monthly' | 'permanent'; amount: number; closed: boolean }>(
    `select f.bucket, -f.delta as amount,
            exists (select 1 from credit_ledger x where x.task_id = f.task_id and x.bucket = f.bucket
                    and x.reason in ('consume','release')) as closed
       from credit_ledger f where f.task_id = $1 and f.reason = 'freeze'`,
    [taskId],
  );
  const task = (await c.query<{ frozen_cycle_ends_at: Date | null }>('select frozen_cycle_ends_at from tasks where id = $1', [taskId])).rows[0];
  const short = taskId.slice(0, 8);
  for (const r of rows.rows) {
    if (r.closed) continue;
    const frozenCol = r.bucket === 'monthly' ? 'frozen_monthly' : 'frozen_permanent';
    const balanceCol = r.bucket === 'monthly' ? 'monthly_balance' : 'permanent_balance';
    if (outcome === 'consume') {
      await c.query(`update credit_accounts set ${frozenCol} = ${frozenCol} - $2 where user_id = $1`, [userId, r.amount]);
      await c.query(`insert into credit_ledger (user_id,bucket,delta,reason,task_id,note) values ($1,$2,$3,'consume',$4,$5)`,
        [userId, r.bucket, -r.amount, taskId, `Generación ${short}`]);
      continue;
    }
    const expired = r.bucket === 'monthly' && task?.frozen_cycle_ends_at?.getTime() !== a.monthly_cycle_ends_at?.getTime();
    await c.query(`insert into credit_ledger (user_id,bucket,delta,reason,task_id,note) values ($1,$2,$3,'release',$4,$5)`,
      [userId, r.bucket, r.amount, taskId, `Devolución ${short}`]);
    if (expired) {
      // créditos de un ciclo ya renovado: se devuelven y caducan en la misma transacción
      await c.query(`update credit_accounts set ${frozenCol} = ${frozenCol} - $2 where user_id = $1`, [userId, r.amount]);
      await c.query(`insert into credit_ledger (user_id,bucket,delta,reason,task_id,note) values ($1,'monthly',$2,'expire',$3,'Créditos del ciclo anterior')`,
        [userId, -r.amount, taskId]);
    } else {
      await c.query(`update credit_accounts set ${frozenCol} = ${frozenCol} - $2, ${balanceCol} = ${balanceCol} + $2 where user_id = $1`, [userId, r.amount]);
    }
  }
}

/**
 * Renueva la bolsa mensual y concede `amount`. `eventId` evita conceder dos veces.
 * Arrastre (fixes.md F2): lo no gastado pasa al ciclo nuevo, como mucho lo que se concedió el ciclo anterior;
 * así nada dura más de dos ciclos y el resto caduca.
 */
export async function renewMonthly(c: Tx, userId: string, amount: number, cycleEndsAt: Date, note: string, eventId?: string): Promise<boolean> {
  if (eventId) {
    const seen = await c.query(`select 1 from credit_ledger where stripe_event_id = $1`, [eventId]);
    if (seen.rowCount) return false;
  }
  const a = await lockAccount(c, userId);
  const last = await c.query<{ delta: number }>(
    `select delta from credit_ledger where user_id = $1 and bucket = 'monthly' and reason = 'grant' order by created_at desc limit 1`, [userId]);
  const carry = Math.max(0, Math.min(a.monthly_balance, last.rows[0]?.delta ?? 0));
  const expired = a.monthly_balance - carry;
  if (expired > 0) {
    await c.query(`insert into credit_ledger (user_id,bucket,delta,reason,note) values ($1,'monthly',$2,'expire','Fin del ciclo (más de un mes sin usar)')`,
      [userId, -expired]);
  }
  await c.query(`update credit_accounts set monthly_balance = $2, monthly_cycle_ends_at = $3 where user_id = $1`, [userId, amount + carry, cycleEndsAt]);
  if (amount > 0) {
    await c.query(`insert into credit_ledger (user_id,bucket,delta,reason,note,stripe_event_id) values ($1,'monthly',$2,'grant',$3,$4)`,
      [userId, amount, carry ? `${note} (+${carry} del mes anterior)` : note, eventId ?? null]);
  }
  return true;
}
