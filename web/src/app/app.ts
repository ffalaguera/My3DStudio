import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TopNav } from './shell/top-nav';
import { LoginModal } from './shell/login-modal';
import { PaywallModal } from './shell/paywall-modal';
import { ToastHost } from './ui/toast';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, TopNav, LoginModal, PaywallModal, ToastHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 btn btn-primary">Saltar al contenido</a>
    <header class="sticky top-0 z-30"><app-top-nav /></header>
    <main id="main" tabindex="-1" class="outline-none"><router-outlet /></main>
    <app-login-modal />
    <app-paywall-modal />
    <ui-toasts />
  `,
})
export class App {}
