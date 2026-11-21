import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { TopNav } from './shell/top-nav';
import { LoginModal } from './shell/login-modal';
import { PaywallModal } from './shell/paywall-modal';
import { ToastHost } from './ui/toast';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, TopNav, LoginModal, PaywallModal, ToastHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 btn btn-primary">Saltar al contenido</a>
    <header class="sticky top-0 z-30"><app-top-nav /></header>
    <main id="main" tabindex="-1" class="outline-none"><router-outlet /></main>
    @if (showFooter()) {
      <footer class="max-w-content mx-auto px-4 py-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-text-muted border-t border-border">
        <span>© 2026 My3DStudio</span>
        <a routerLink="/precios" class="underline">Precios</a>
        <a routerLink="/terminos" class="underline">Términos</a>
        <a routerLink="/privacidad" class="underline">Privacidad</a>
      </footer>
    }
    <app-login-modal />
    <app-paywall-modal />
    <ui-toasts />
  `,
})
export class App {
  private readonly router = inject(Router);
  /** El espacio de trabajo ocupa toda la pantalla: sin pie. */
  protected readonly showFooter = toSignal(
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map(() => !this.router.url.startsWith('/crear'))),
    { initialValue: false });
}
