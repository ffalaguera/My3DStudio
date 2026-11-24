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
  private static readonly KEY = 'my3dstudio:local-token';
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

/** Script oficial de Google Identity Services (botón «Continuar con Google»), cargado solo cuando hace falta. */
interface GoogleId {
  initialize(o: { client_id: string; callback: (r: { credential?: string }) => void; ux_mode?: 'popup'; use_fedcm_for_prompt?: boolean;
    cancel_on_tap_outside?: boolean }): void;
  prompt(cb?: (n: { isNotDisplayed(): boolean; isSkippedMoment(): boolean }) => void): void;
  renderButton(el: HTMLElement, o: Record<string, string | number>): void;
  cancel(): void;
}
declare global {
  interface Window { google?: { accounts: { id: GoogleId } } }
}

function loadGoogle(): Promise<GoogleId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('gsi')));
    s.onerror = () => reject(new Error('gsi'));
    document.head.appendChild(s);
  });
}

/**
 * Acceso propio (servidor con AUTH_PROVIDER=self, Better Auth): sin servicios externos de login.
 * - Email: la API envía un enlace a /entrar?token=…, que se canjea aquí por una sesión.
 * - Google: el botón oficial de Google entrega un ID token que la API verifica con Google.
 * La sesión es un token opaco y revocable que viaja en Authorization: Bearer (sin cookies).
 */
export class SelfAuth implements AuthClient {
  private static readonly KEY = 'my3dstudio:session';
  private static readonly RETURN = 'my3dstudio:return-to';
  readonly user$ = new BehaviorSubject<Profile | null>(null);
  readonly ready: Promise<void>;
  private tok: string | null = null;

  constructor(private readonly apiUrl: string, private readonly googleClientId?: string) {
    try {
      const raw = localStorage.getItem(SelfAuth.KEY);
      if (raw) {
        const { token, profile } = JSON.parse(raw) as { token: string; profile: Profile };
        this.tok = token;
        this.user$.next(profile);
      }
    } catch {
      /* sin almacenamiento o sesión corrupta */
    }
    // la sesión guardada puede estar caducada o revocada: se comprueba con la API
    this.ready = this.tok ? this.check() : Promise.resolve();
  }

  private async check(): Promise<void> {
    const r = await fetch(`${this.apiUrl}/api/auth/get-session`, { headers: { Authorization: `Bearer ${this.tok}` } }).catch(() => null);
    if (!r) return; // sin red: se mantiene y la API dirá 401 si no vale
    const body = r.ok ? await r.json().catch(() => null) : null;
    if (!body?.user?.email) this.clear();
  }

  async token() {
    return this.tok;
  }

  async signIn(method: 'google' | 'email', email?: string): Promise<Profile> {
    if (method === 'google') return this.google();
    const addr = (email ?? '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) throw new ApiError(422, 'invalid_email', 'Escribe un email válido');
    const r = await fetch(`${this.apiUrl}/api/auth/sign-in/magic-link`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: addr }),
    }).catch(() => null);
    if (!r?.ok) {
      throw new ApiError(r?.status ?? 0, 'auth_error',
        r?.status === 429 ? 'Has pedido demasiados enlaces. Espera un minuto' : 'No se ha podido enviar el enlace. Inténtalo de nuevo');
    }
    try {
      sessionStorage.setItem(SelfAuth.RETURN, location.pathname + location.search); // volver aquí tras abrir el enlace
    } catch {
      /* nada */
    }
    throw new ApiError(202, 'check_email', `Te hemos enviado un enlace a ${addr}. Caduca en 10 minutos: ábrelo en este navegador`);
  }

  /** Canjea el token del enlace del email (página /entrar). Devuelve adónde volver. */
  async completeEmailSignIn(token: string): Promise<string> {
    const r = await fetch(`${this.apiUrl}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`, { redirect: 'manual' })
      .catch(() => null);
    const body = r?.ok ? await r.json().catch(() => null) : null;
    if (!body?.token || !body.user?.email) {
      throw new ApiError(401, 'link_invalid', 'El enlace ha caducado o ya se usó. Pide uno nuevo');
    }
    this.save(body.token, toProfile(body.user.id, body.user.email));
    let back = '/';
    try {
      back = sessionStorage.getItem(SelfAuth.RETURN) || '/';
      sessionStorage.removeItem(SelfAuth.RETURN);
    } catch {
      /* nada */
    }
    return back.startsWith('/') && !back.startsWith('//') ? back : '/'; // solo rutas propias: sin redirecciones abiertas
  }

  private async google(): Promise<Profile> {
    if (!this.googleClientId) throw new ApiError(503, 'auth_error', 'El acceso con Google aún no está activado. Usa el email');
    const gsi = await loadGoogle().catch(() => {
      throw new ApiError(503, 'auth_error', 'No se ha podido cargar Google. Revisa tu conexión o usa el email');
    });
    const credential = await new Promise<string>((resolve, reject) => {
      let panel: HTMLElement | null = null;
      const close = () => panel?.remove();
      gsi.initialize({
        client_id: this.googleClientId!, ux_mode: 'popup', use_fedcm_for_prompt: true, cancel_on_tap_outside: true,
        callback: (res) => {
          close();
          if (res.credential) resolve(res.credential);
          else reject(new ApiError(400, 'auth_error', 'Google no ha devuelto tu cuenta. Inténtalo de nuevo'));
        },
      });
      gsi.prompt((n) => {
        if (!n.isNotDisplayed() && !n.isSkippedMoment()) return;
        // el navegador no mostró el aviso de Google (bloqueado o descartado antes): botón oficial en un panel
        panel = document.createElement('div');
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Continuar con Google');
        panel.style.cssText = 'position:fixed;inset:auto 16px 16px auto;z-index:1000;padding:16px;border-radius:12px;'
          + 'background:#fff;box-shadow:0 8px 32px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:8px;align-items:flex-end';
        const slot = document.createElement('div');
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancelar';
        cancel.style.cssText = 'font:14px system-ui;color:#333;background:none;border:0;cursor:pointer;text-decoration:underline';
        cancel.onclick = () => {
          close();
          reject(new ApiError(400, 'auth_error', 'Has cancelado el acceso con Google'));
        };
        panel.append(slot, cancel);
        document.body.appendChild(panel);
        gsi.renderButton(slot, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', locale: 'es' });
      });
    });
    const r = await fetch(`${this.apiUrl}/api/auth/sign-in/social`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'google', idToken: { token: credential } }),
    }).catch(() => null);
    const body = r?.ok ? await r.json().catch(() => null) : null;
    if (!body?.token || !body.user?.email) throw new ApiError(r?.status ?? 0, 'auth_error', 'No se ha podido entrar con Google');
    const profile = toProfile(body.user.id, body.user.email);
    this.save(body.token, profile);
    return profile;
  }

  async signOut() {
    const tok = this.tok;
    this.clear();
    // revoca la sesión en el servidor (si falla la red, al menos se olvida aquí)
    if (tok) await fetch(`${this.apiUrl}/api/auth/sign-out`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` } }).catch(() => {});
  }

  private save(token: string, profile: Profile) {
    this.tok = token;
    try {
      localStorage.setItem(SelfAuth.KEY, JSON.stringify({ token, profile }));
    } catch {
      /* sin almacenamiento: la sesión dura lo que la pestaña */
    }
    this.user$.next(profile);
  }

  private clear() {
    this.tok = null;
    try {
      localStorage.removeItem(SelfAuth.KEY);
    } catch {
      /* nada */
    }
    if (this.user$.value) this.user$.next(null);
  }
}
