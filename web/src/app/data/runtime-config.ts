import { InjectionToken } from '@angular/core';

/**
 * Configuración en tiempo de ejecución (public/config.json), para que el mismo build sirva en local y en producción.
 * Solo valores públicos: la anon key de Supabase es pública por diseño. Nunca secretos aquí.
 */
export interface RuntimeConfig {
  /** fake = demo en el navegador sin servidor; http = API real */
  api: 'fake' | 'http';
  apiUrl?: string;
  /** local = acceso de desarrollo (LOCAL_AUTH del servidor); supabase = Supabase Auth; self = acceso propio (Better Auth) */
  auth?: 'local' | 'supabase' | 'self';
  /** Solo con auth=self: el «Client ID» público de tu app OAuth de Google (vacío = sin botón de Google) */
  googleClientId?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

export const RUNTIME_CONFIG = new InjectionToken<RuntimeConfig>('RUNTIME_CONFIG');

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const r = await fetch('/config.json', { cache: 'no-store' });
    if (r.ok) return (await r.json()) as RuntimeConfig;
  } catch {
    /* sin config: modo demostración */
  }
  return { api: 'fake' };
}
