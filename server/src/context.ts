import type Stripe from 'stripe';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { Storage } from './lib/storage.js';
import type { Mailer } from './lib/email.js';

export interface Ctx {
  cfg: Config;
  db: Db;
  storage: Storage;
  mailer: Mailer;
  stripe: Stripe | null;
  /** Borra un usuario de Supabase Auth (o de auth.users en local). */
  deleteAuthUser: (userId: string) => Promise<void>;
}
