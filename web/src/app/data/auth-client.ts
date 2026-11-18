import { BehaviorSubject } from 'rxjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type Profile } from './api';
import type { RuntimeConfig } from './runtime-config';

/** Sesión del usuario: da el token para la API y el perfil básico. */
export interface AuthClient {
  readonly user$: BehaviorSubject<Profile | null>;
  ready: Promise<void>;
  token(): Promise<string | null>;
  signIn(method: 'google' | 'email', email?: string): Promise<Profile>;
  signOut(): Promise<void>;
}

const toProfile = (id: string, email: string): Profile => ({ id, email, displayName: email.split('@')[0] });

/** Supabase Auth: Google con tu propia app OAuth y enlace mágico por email. */
export class SupabaseAuth implements AuthClient {
  readonly user$ = new BehaviorSubject<Profile | null>(null);
  readonly ready: Promise<void>;
  private readonly client: Promise<SupabaseClient>;

  constructor(cfg: RuntimeConfig) {
    // la librería se carga bajo demanda: no pesa en el arranque si no se usa Supabase
    this.client = import('@supabase/supabase-js').then(({ createClient }) => {
      const sb = createClient(cfg.supabaseUrl!, cfg.supabaseAnonKey!, {
        auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      sb.auth.onAuthStateChange((_e, session) => {
        const u = session?.user;
        const next = u?.email ? toProfile(u.id, u.email) : null;
        if (next?.id !== this.user$.value?.id) this.user$.next(next);
      });
      return sb;
    });
    this.ready = this.client.then(async (sb) => {
      const u = (await sb.auth.getSession()).data.session?.user;
      this.user$.next(u?.email ? toProfile(u.id, u.email) : null);
    });
  }

  private get sb(): Promise<SupabaseClient> {
    return this.client;
  }

  async token() {
    return (await (await this.sb).auth.getSession()).data.session?.access_token ?? null;
  }

  async signIn(method: 'google' | 'email', email?: string): Promise<Profile> {
    const redirectTo = `${location.origin}${location.pathname}`;
    if (method === 'google') {
      const { error } = await (await this.sb).auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
      if (error) throw new ApiError(400, 'auth_error', 'No se ha podido abrir Google. Inténtalo de nuevo');
      throw new ApiError(202, 'redirecting', 'Abriendo Google…');
    }
    const addr = (email ?? '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) throw new ApiError(422, 'invalid_email', 'Escribe un email válido');
    const { error } = await (await this.sb).auth.signInWithOtp({ email: addr, options: { emailRedirectTo: redirectTo } });
    if (error) {
      throw new ApiError(error.status ?? 400, 'auth_error',
        error.status === 429 ? 'Has pedido demasiados enlaces. Espera un minuto' : 'No se ha podido enviar el enlace');
    }
    throw new ApiError(202, 'check_email', `Te hemos enviado un enlace a ${addr}. Ábrelo en este navegador para entrar`);
  }

  async signOut() {
    await (await this.sb).auth.signOut({ scope: 'global' }); // cierra la sesión en todos los dispositivos
    this.user$.next(null);
  }
}

/** Solo desarrollo (servidor con LOCAL_AUTH=1): entra con cualquier email, sin contraseña. */
export class LocalAuth implements AuthClient {
  private static readonly KEY = 'clon-tripo:local-token';
  readonly user$ = new BehaviorSubject<Profile | null>(null);
  readonly ready = Promise.resolve();
  private tok: string | null = null;

  constructor(private readonly apiUrl: string) {
    try {
      const raw = sessionStorage.getItem(LocalAuth.KEY);
      if (raw) {
        const { token, profile } = JSON.parse(raw) as { token: string; profile: Profile };
        const exp = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp as number;
        if (exp * 1000 > Date.now()) {
          this.tok = token;
          this.user$.next(profile);
        }
      }
    } catch {
      /* sesión local no válida */
    }
  }

  async token() {
    return this.tok;
  }

  async signIn(method: 'google' | 'email', email?: string): Promise<Profile> {
    // En local no hay Google: "Continuar con Google" entra como el usuario de demostración del seed.
    const addr = method === 'google' ? 'demo@example.com' : (email ?? '').trim();
    const r = await fetch(`${this.apiUrl}/api/dev/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: addr }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = r.status === 422 ? 'Escribe un email válido'
        : r.status === 429 ? 'Demasiados intentos. Espera un minuto y vuelve a probar' : 'No se ha podido entrar';
      throw new ApiError(r.status, body.error?.code ?? 'auth_error', msg);
    }
    this.tok = body.token;
    const profile = toProfile(body.user.id, body.user.email);
    try {
      sessionStorage.setItem(LocalAuth.KEY, JSON.stringify({ token: this.tok, profile }));
    } catch {
      /* sin almacenamiento: la sesión dura lo que la pestaña */
    }
    this.user$.next(profile);
    return profile;
  }

  async signOut() {
    this.tok = null;
    try {
      sessionStorage.removeItem(LocalAuth.KEY);
    } catch {
      /* nada */
    }
    this.user$.next(null);
  }
}
