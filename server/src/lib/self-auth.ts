import { betterAuth } from 'better-auth';
import { bearer, magicLink } from 'better-auth/plugins';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { Mailer } from './email.js';

/**
 * Acceso propio (AUTH_PROVIDER=self) con Better Auth, sin servicios externos: enlace mágico por email y Google.
 * Todo vive en tu Postgres (tablas ba_*). Sin cookies: la sesión viaja en `Authorization: Bearer`, igual que antes,
 * así que no hay CSRF posible y la web y la API pueden estar en dominios distintos.
 *
 * - Enlace mágico: caduca a los 10 minutos, es de un solo uso y se guarda cifrado (hash) en la base.
 *   El email lleva a la web (/entrar?token=…), que lo canjea por una sesión.
 * - Google: la web obtiene un ID token con el botón oficial de Google y la API lo verifica con Google.
 * - Sesiones de 30 días, revocables (cerrar sesión las borra de la base).
 */
export function createSelfAuth(cfg: Config, db: Db, mailer: Mailer) {
  return betterAuth({
    appName: 'My3DStudio',
    baseURL: cfg.PUBLIC_API_URL,
    basePath: '/api/auth',
    secret: cfg.BETTER_AUTH_SECRET,
    database: db,
    trustedOrigins: [cfg.APP_URL],
    telemetry: { enabled: false },
    user: { modelName: 'ba_user' },
    session: { modelName: 'ba_session', expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    account: { modelName: 'ba_account' },
    verification: { modelName: 'ba_verification' },
    // Las tablas las crea nuestra migración 0005 al arrancar, después de crear esta instancia: la validación
    // automática de Better Auth se haría antes de migrar y se quedaría con un falso «faltan tablas».
    advanced: { database: { generateId: 'uuid', validateSchema: false } },
    emailAndPassword: { enabled: false },
    socialProviders: cfg.GOOGLE_CLIENT_ID
      ? { google: { clientId: cfg.GOOGLE_CLIENT_ID, clientSecret: cfg.GOOGLE_CLIENT_SECRET ?? '' } }
      : {},
    // Límite propio de Better Auth (además del global por IP de la API)
    rateLimit: { enabled: cfg.NODE_ENV !== 'test', window: 60, max: 30 },
    databaseHooks: {
      user: {
        create: {
          // los perfiles de la app cuelgan de auth.users (como en Supabase): se crea la fila con el mismo id
          after: async (user) => {
            await db.query('insert into auth.users (id, email) values ($1, lower($2)) on conflict (id) do nothing', [user.id, user.email]);
          },
        },
      },
    },
    plugins: [
      bearer(),
      magicLink({
        expiresIn: 10 * 60,
        storeToken: 'hashed',
        sendMagicLink: async ({ email, token }) => {
          await mailer.send(email, { kind: 'magic_link', url: `${cfg.APP_URL}/entrar?token=${encodeURIComponent(token)}` });
        },
      }),
    ],
  });
}

export type SelfAuth = ReturnType<typeof createSelfAuth>;
