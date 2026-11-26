import { ChangeDetectionStrategy, Component, Injector, afterNextRender, inject } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
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
        <a routerLink="/precios" class="underline inline-block py-[3px] -my-[3px]">Precios</a>
        <a routerLink="/terminos" class="underline inline-block py-[3px] -my-[3px]">Términos</a>
        <a routerLink="/privacidad" class="underline inline-block py-[3px] -my-[3px]">Privacidad</a>
      </footer>
    }
    <app-login-modal />
    <app-paywall-modal />
    <ui-toasts />
  `,
})
export class App {
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private lastPath = '';
  /** El espacio de trabajo ocupa toda la pantalla: sin pie. */
  protected readonly showFooter = toSignal(
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map(() => !this.router.url.startsWith('/crear'))),
    { initialValue: false });

  constructor() {
    // Al cambiar de página el foco se quedaba en el enlace pulsado de la barra: quien usa lector de pantalla
    // no se enteraba del cambio. Se lleva al titular de la página nueva (o a <main>). Solo si cambia la ruta,
    // no al cambiar parámetros (?tarea=…, ?serie=…), y nunca en la primera carga.
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed()).subscribe((e) => {
      const path = e.urlAfterRedirects.split(/[?#]/)[0];
      const changed = this.lastPath !== '' && path !== this.lastPath;
      this.lastPath = path;
      if (changed) afterNextRender(() => this.focusPage(), { injector: this.injector });
    });
  }

  private focusPage(): void {
    const main = document.getElementById('main');
    if (!main || main.contains(document.activeElement) && document.activeElement !== main) return;
    const heading = main.querySelector<HTMLElement>('h1');
    if (heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    (heading ?? main).focus({ preventScroll: true });
  }
}
