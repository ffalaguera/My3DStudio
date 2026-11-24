import type Stripe from 'stripe';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { Storage } from './lib/storage.js';
import type { Mailer } from './lib/email.js';
import type { SecurityLog } from './lib/security-log.js';
import type { SelfAuth } from './lib/self-auth.js';

export interface Ctx {
  cfg: Config;
  db: Db;
  storage: Storage;
  mailer: Mailer;
  stripe: Stripe | null;
  /** Borra un usuario de Supabase Auth (o de auth.users en local). */
  deleteAuthUser: (userId: string) => Promise<void>;
  /** Registro de actividad sospechosa (lib/security-log.ts). */
  security: SecurityLog;
  /** Acceso propio (AUTH_PROVIDER=self); null con Supabase o LOCAL_AUTH. */
  selfAuth: SelfAuth | null;
}
