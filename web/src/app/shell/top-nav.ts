import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IsActiveMatchOptions, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { Icon } from '../ui/icon';
import { Gates } from './gates';
import { Api } from '../data/api';

/**
 * Barra principal. El menú estrecho (móvil) es navegación, no un menú de aplicación
 * (modern-web-guidance: navbar y menu): popover="auto" con popovertarget, sin role="menu" ni flechas.
 * El navegador da Esc, cierre al pulsar fuera y la vuelta del foco al botón.
 */
@Component({
  selector: 'app-top-nav',
  imports: [RouterLink, RouterLinkActive, Icon, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Barra mínima: sin cápsula ni sombra, enlaces de texto con subrayado y un único botón destacado -->
    <nav aria-label="Principal"
      class="h-[3.75rem] max-w-[80rem] mx-auto flex items-center gap-3 sm:gap-6 px-4 sm:px-8">
      <a routerLink="/" class="flex items-center gap-2 pr-1 rounded-md" aria-label="Inicio">
        <span class="w-8 h-8 rounded-full bg-accent text-on-accent grid place-items-center text-xs font-bold">3D</span>
        <span class="hidden sm:inline font-display text-[1.25rem] font-medium tracking-tight">My3DStudio</span>
      </a>

      <!-- «Crear» lleva directo al espacio de trabajo: allí se elige alto detalle o topología limpia -->
      <a routerLink="/crear" routerLinkActive="nav-link-active" ariaCurrentWhenActive="page" [routerLinkActiveOptions]="activeOptions"
        class="nav-link">Crear</a>

      <div class="hidden md:flex items-center gap-6">
        @for (l of links; track l.label) {
          @if (l.path !== '/crear') {
            <a [routerLink]="l.path" [fragment]="l.fragment" (click)="sameAnchor(l.fragment)"
              routerLinkActive="nav-link-active" ariaCurrentWhenActive="page" [routerLinkActiveOptions]="activeOptions"
              class="nav-link">{{ l.label }}</a>
          }
        }
      </div>

      <div class="ml-auto flex items-center gap-2">
        @if (gates.me(); as me) {
          @if (me.generations; as g) {
            <!-- tienda: lo que importa es cuántos modelos gratis quedan hoy y los pedidos -->
            @if (me.isAdmin) { <a routerLink="/taller" class="btn btn-sm btn-ghost">Taller</a> }
            <a routerLink="/pedidos" class="btn btn-sm btn-ghost">Mis pedidos</a>
            @if (g.perDay) {
              <span class="hidden lg:inline text-xs text-text-muted figures" [attr.aria-label]="'Modelos gratis que te quedan hoy: ' + remaining(g)">
                {{ remaining(g) }} de {{ g.perDay }} gratis hoy</span>
            }
          } @else {
            <a routerLink="/cuenta" class="btn btn-sm btn-ghost" [attr.aria-label]="'Créditos disponibles: ' + me.credits.available">
              <ui-icon name="zap" /> {{ me.credits.available | number: '1.0-0' : 'es' }}
            </a>
          }
          <a routerLink="/cuenta" class="w-8 h-8 rounded-full bg-surface-3 grid place-items-center text-xs uppercase"
            [attr.aria-label]="'Tu cuenta (' + me.profile.email + ')'">{{ me.profile.displayName.slice(0, 2) }}</a>
        } @else {
          <button type="button" class="btn btn-sm btn-primary" (click)="gates.ensureSignedIn()">Entrar</button>
        }
        <button type="button" class="btn btn-icon md:hidden nav-anchor-site" aria-label="Menú" popovertarget="site-menu" aria-controls="site-menu">
          <ui-icon name="menu" />
        </button>
        <!-- Menú estrecho: la misma navegación, dentro del landmark <nav> -->
        <div id="site-menu" popover="auto" #siteMenu class="nav-popover nav-popover-site panel shadow-pop p-2 text-text md:hidden">
          <ul class="flex flex-col text-sm">
            @for (l of links; track l.label) {
              <li><a [routerLink]="l.path" [fragment]="l.fragment" (click)="close(siteMenu); sameAnchor(l.fragment)"
                routerLinkActive="bg-surface-3" ariaCurrentWhenActive="page" [routerLinkActiveOptions]="activeOptions"
                class="block p-3 rounded-md hover:bg-surface-3">{{ l.label }}</a></li>
            }
          </ul>
        </div>
      </div>
    </nav>
  `,
})
export class TopNav {
  protected readonly gates = inject(Gates);
  protected readonly api = inject(Api);
  private readonly router = inject(Router);
  // «Precios» baja a la sección de precios de la portada (#precio)
  protected readonly links: { path: string; label: string; fragment?: string }[] = [
    { path: '/', label: 'Inicio' }, { path: '/crear', label: 'Crear' },
    { path: '/galeria', label: 'Galería' }, { path: '/', label: 'Precios', fragment: 'precio' },
  ];
  // la ruta exacta y el ancla: «Inicio» y «Precios» comparten «/», solo se marca el que coincide
  protected readonly activeOptions: IsActiveMatchOptions = { paths: 'exact', fragment: 'exact', queryParams: 'ignored', matrixParams: 'ignored' };

  /** Pulsar otra vez un ancla en la que ya estás no navega (misma URL): se baja a mano. */
  protected sameAnchor(fragment?: string): void {
    if (!fragment || this.router.url !== `/#${fragment}`) return;
    const target = document.getElementById(fragment);
    target?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    target?.focus({ preventScroll: true });
  }

  protected remaining(g: { perDay: number | null; today: number }): number {
    return Math.max(0, (g.perDay ?? 0) - g.today);
  }

  /** Navegar dentro de la SPA no cierra el popover solo: se cierra al elegir un enlace. */
  protected close(popover: HTMLElement): void {
    if (popover.matches(':popover-open, .\\:popover-open')) popover.hidePopover();
  }
}
