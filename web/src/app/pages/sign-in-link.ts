import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, ApiError } from '../data/api';
import { Gates } from '../shell/gates';

/** /entrar?token=…: destino del enlace mágico del email. Canjea el token por una sesión y vuelve adonde estabas. */
@Component({
  selector: 'app-sign-in-link',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="max-w-md mx-auto px-4 py-16 flex flex-col items-center gap-4 text-center" aria-live="polite">
      @if (error()) {
        <h1 class="text-xl">No hemos podido entrar</h1>
        <p class="text-text-muted" role="alert">{{ error() }}</p>
        <button type="button" class="btn btn-primary" (click)="retry()">Pedir otro enlace</button>
        <a routerLink="/" class="text-sm underline text-text-muted">Volver al inicio</a>
      } @else {
        <h1 class="text-xl">Entrando…</h1>
        <p class="text-text-muted">Un momento, estamos comprobando tu enlace.</p>
      }
    </section>
  `,
})
export class SignInLink {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly gates = inject(Gates);
  protected readonly error = signal('');

  constructor() {
    const token = inject(ActivatedRoute).snapshot.queryParamMap.get('token');
    if (!token) {
      this.error.set('Al enlace le falta el código. Ábrelo tal cual llegó en el email');
      return;
    }
    // el token no se queda en la barra de direcciones ni en el historial
    history.replaceState(null, '', '/entrar');
    void this.api.completeEmailSignIn(token)
      .then((back) => this.router.navigateByUrl(back, { replaceUrl: true }))
      .catch((e) => this.error.set(e instanceof ApiError ? e.message : 'El enlace ha caducado o ya se usó. Pide uno nuevo'));
  }

  protected retry(): void {
    void this.router.navigateByUrl('/', { replaceUrl: true }).then(() => this.gates.ensureSignedIn());
  }
}
