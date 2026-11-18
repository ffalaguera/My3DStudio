import { Injectable, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Api, Estimate } from '../data/api';

/** Estado global de la app: sesión, perfil y los modales de acceso (S02) y de plan (S13). */
@Injectable({ providedIn: 'root' })
export class Gates {
  private readonly api = inject(Api);
  readonly me = toSignal(this.api.me(), { initialValue: null });

  readonly loginOpen = signal(false);
  readonly paywall = signal<{ title: string; detail: string; kind: Estimate['reason'] } | null>(null);
  private loginResolve: ((ok: boolean) => void) | null = null;

  /** Abre S02 si no hay sesión. Resuelve true cuando el usuario ha entrado. */
  ensureSignedIn(): Promise<boolean> {
    if (this.me()) return Promise.resolve(true);
    this.loginOpen.set(true);
    return new Promise((res) => (this.loginResolve = res));
  }

  loginFinished(ok: boolean): void {
    this.loginOpen.set(false);
    this.loginResolve?.(ok);
    this.loginResolve = null;
  }

  showPaywall(kind: Estimate['reason'], detail: string): void {
    const title = kind === 'insufficient_credits' ? 'No tienes créditos suficientes' : 'Esto no está en tu plan';
    this.paywall.set({ title, detail, kind });
  }
}
