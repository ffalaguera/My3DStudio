import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import type { Config } from '../config.js';
import type { Db, Tx } from '../db.js';
import { tx } from '../db.js';
import { HttpError } from './http.js';
import type { SelfAuth } from './self-auth.js';

export interface AuthUser {
  id: string;
  email: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * Verifica el JWT de Supabase Auth (cabecera Authorization: Bearer).
 * - Proyectos nuevos de Supabase firman con claves asimétricas: se validan con el JWKS público.
 * - Proyectos con secreto compartido: SUPABASE_JWT_SECRET (HS256).
 * - LOCAL_AUTH=1 (solo desarrollo/tests): tokens firmados con LOCAL_JWT_SECRET por /api/dev/login.
 */
export function createVerifier(cfg: Config) {
  const jwks = cfg.SUPABASE_URL ? createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', cfg.SUPABASE_URL)) : null;
  const shared = cfg.SUPABASE_JWT_SECRET ? new TextEncoder().encode(cfg.SUPABASE_JWT_SECRET) : null;
  const local = cfg.LOCAL_AUTH && cfg.LOCAL_JWT_SECRET ? new TextEncoder().encode(cfg.LOCAL_JWT_SECRET) : null;
  const issuer = cfg.SUPABASE_URL ? new URL('/auth/v1', cfg.SUPABASE_URL).toString() : undefined;

  return async function verify(token: string): Promise<AuthUser> {
    const attempts: (() => Promise<JWTPayload>)[] = [];
    if (local) attempts.push(async () => (await jwtVerify(token, local, { issuer: 'local-dev', audience: 'authenticated' })).payload);
    if (shared) attempts.push(async () => (await jwtVerify(token, shared, { issuer, audience: 'authenticated' })).payload);
    if (jwks) attempts.push(async () => (await jwtVerify(token, jwks, { issuer, audience: 'authenticated' })).payload);
    for (const a of attempts) {
      try {
        const p = await a();
        if (typeof p.sub === 'string' && typeof p['email'] === 'string') return { id: p.sub, email: p['email'] };
      } catch {
        /* probar el siguiente verificador */
      }
    }
    throw new HttpError(401, 'not_signed_in', 'Tu sesión ha caducado. Vuelve a entrar');
  };
}

export async function signLocalToken(cfg: Config, user: AuthUser): Promise<string> {
  if (!cfg.LOCAL_AUTH || !cfg.LOCAL_JWT_SECRET) throw new Error('LOCAL_AUTH desactivado');
  return new SignJWT({ email: user.email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer('local-dev')
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(new TextEncoder().encode(cfg.LOCAL_JWT_SECRET));
}

/** Crea perfil y cuenta de créditos la primera vez que entra un usuario, con los créditos de bienvenida. */
export async function ensureProfile(c: Tx, user: AuthUser): Promise<void> {
  const ins = await c.query(
    `insert into profiles (id, email, display_name) values ($1, $2, split_part($2, '@', 1))
     on conflict (id) do update set email = excluded.email
     returning (xmax = 0) as created`,
    [user.id, user.email],
  );
  if (!ins.rows[0].created) return;
  const free = (await c.query(`select monthly_credits from plans where id = 'free'`)).rows[0].monthly_credits as number;
  await c.query(
    `insert into credit_accounts (user_id, monthly_balance, monthly_cycle_ends_at)
     values ($1, $2, date_trunc('month', now() at time zone 'utc') at time zone 'utc' + interval '1 month')`,
    [user.id, free],
  );
  if (free > 0) {
    await c.query(
      `insert into credit_ledger (user_id, bucket, delta, reason, note) values ($1, 'monthly', $2, 'grant', 'Créditos de bienvenida')`,
      [user.id, free],
    );
  }
}

/** Acceso propio: el token es una sesión de Better Auth (revocable), no un JWT. */
function selfVerifier(selfAuth: SelfAuth) {
  return async (token: string): Promise<AuthUser> => {
    const s = await selfAuth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) }).catch(() => null);
    if (!s?.user?.email) throw new HttpError(401, 'not_signed_in', 'Tu sesión ha caducado. Vuelve a entrar');
    return { id: s.user.id, email: s.user.email };
  };
}

export function requireUser(cfg: Config, db: Db, selfAuth: SelfAuth | null = null) {
  const verify = selfAuth ? selfVerifier(selfAuth) : createVerifier(cfg);
  const known = new Set<string>(); // perfiles ya comprobados en este proceso
  const mw = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const h = req.headers.authorization ?? '';
      if (!h.startsWith('Bearer ')) throw new HttpError(401, 'not_signed_in', 'Inicia sesión para continuar');
      const user = await verify(h.slice(7));
      if (!known.has(user.id)) {
        const exists = await db.query('select 1 from profiles where id = $1', [user.id]);
        if (!exists.rowCount) {
          // si el usuario ya no existe en auth.users (cuenta borrada) la FK falla: sesión no válida
          await tx(db, (c) => ensureProfile(c, user)).catch((e: { code?: string }) => {
            if (e.code === '23503') throw new HttpError(401, 'not_signed_in', 'Esta cuenta ya no existe');
            throw e;
          });
        }
        known.add(user.id);
      }
      req.user = user;
      next();
    } catch (e) {
      next(e);
    }
  };
  /** Tras borrar una cuenta: la siguiente petición con ese id vuelve a comprobar el perfil. */
  return Object.assign(mw, { forget: (id: string) => known.delete(id) });
}
