import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Modal } from '../ui/modal';
import { Icon } from '../ui/icon';
import { Api, ApiError } from '../data/api';
import { Gates } from './gates';
import { Toasts } from '../ui/toast';

/** S02: acceso y registro. Con la API falsa no hay contraseñas ni proveedores reales. */
@Component({
  selector: 'app-login-modal',
  imports: [Modal, Icon, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-modal [open]="gates.loginOpen()" heading="Entra y empieza a crear" (closed)="gates.loginFinished(!!gates.session())">
      <p class="text-sm text-text-muted flex items-center gap-2">
        <ui-icon name="zap" /> Crear la cuenta es gratis. Para generar, compra un pack desde 3 € (3 modelos) o elige un plan.
      </p>
      <button type="button" class="btn btn-secondary w-full" [disabled]="busy()" (click)="go('google')">
        <ui-icon name="chrome" /> Continuar con Google
      </button>
      <div class="flex items-center gap-3 text-xs text-text-muted"><span class="flex-1 h-px bg-border"></span>o<span class="flex-1 h-px bg-border"></span></div>
      <form class="flex flex-col gap-3" (ngSubmit)="go('email')">
        <label class="label">Email
          <input class="field h-10 px-3" type="email" name="email" autocomplete="email" required
            [(ngModel)]="email" [attr.aria-invalid]="!!error()" aria-describedby="login-error" />
        </label>
        @if (error()) { <p id="login-error" class="error-text" role="alert">{{ error() }}</p> }
        @if (info()) { <p class="text-sm text-success" role="status">{{ info() }}</p> }
        <button type="submit" class="btn btn-primary w-full" [disabled]="busy()" [attr.aria-busy]="busy()">
          @if (busy()) { <ui-icon name="loader-circle" class="animate-spin" /> Entrando… } @else { Recibir enlace de acceso }
        </button>
      </form>
      <p class="text-xs text-text-muted">Al continuar aceptas los <a routerLink="/terminos" class="underline" (click)="gates.loginFinished(false)">términos</a> y la <a routerLink="/privacidad" class="underline" (click)="gates.loginFinished(false)">política de privacidad</a>.</p>
    </ui-modal>
  `,
})
export class LoginModal {
  protected readonly gates = inject(Gates);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  protected email = '';
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly info = signal('');

  protected async go(method: 'google' | 'email'): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.info.set('');
    try {
      await this.api.signIn(method, this.email);
      this.gates.loginFinished(true);
      this.toasts.show('success', 'Ya has entrado');
    } catch (e) {
      // enlace mágico enviado o redirección a Google: no es un error
      if (e instanceof ApiError && (e.code === 'check_email' || e.code === 'redirecting')) this.info.set(e.message);
      else this.error.set(e instanceof ApiError ? e.message : 'No se ha podido entrar. Inténtalo de nuevo');
    } finally {
      this.busy.set(false);
    }
  }
}
