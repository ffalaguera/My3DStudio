import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { Icon } from '../ui/icon';
import { Gates } from './gates';
import { Api } from '../data/api';

/**
 * Barra principal. Los dos desplegables son navegación (enlaces), no menús de aplicación
 * (modern-web-guidance: navbar y menu): popover="auto" con popovertarget, sin role="menu" ni flechas.
 * El navegador da Esc, cierre al pulsar fuera y la vuelta del foco al botón.
 */
@Component({
  selector: 'app-top-nav',
  imports: [RouterLink, RouterLinkActive, Icon, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav aria-label="Principal"
      class="h-nav mx-3 mt-3 rounded-pill bg-surface/90 backdrop-blur border border-border shadow-float flex items-center gap-2 sm:gap-4 px-2 sm:px-3">
      <a routerLink="/" class="flex items-center gap-2 pr-2 rounded-pill" aria-label="Inicio">
        <span class="w-8 h-8 rounded-full bg-accent text-on-accent grid place-items-center text-xs font-bold">3D</span>
        <span class="hidden sm:inline text-sm font-semibold">My3DStudio</span>
      </a>

      <button type="button" class="btn btn-sm btn-secondary nav-anchor-create" popovertarget="create-menu" aria-controls="create-menu">
        Crear <ui-icon name="chevron-down" />
      </button>
      <!-- El popover va justo después de su botón: así el navegador no añade relaciones implícitas -->
      <div id="create-menu" popover="auto" #createMenu class="nav-popover nav-popover-create panel shadow-pop p-1 w-60 text-text"
        (toggle)="placeCreateMenu($event)">
        <ul class="flex flex-col">
          <li><a routerLink="/crear" [queryParams]="{ serie: 'hd' }" (click)="close(createMenu)"
            class="flex items-center gap-3 p-2 rounded-md hover:bg-surface-3 text-sm">
            <ui-icon name="gem" /> Alto detalle</a></li>
          <li><a routerLink="/crear" [queryParams]="{ serie: 'smart' }" (click)="close(createMenu)"
            class="flex items-center gap-3 p-2 rounded-md hover:bg-surface-3 text-sm">
            <ui-icon name="grid-3x3" /> Topología limpia</a></li>
        </ul>
      </div>

      <div class="hidden md:flex items-center gap-4 text-sm">
        <a routerLink="/" routerLinkActive="!text-text border-text" ariaCurrentWhenActive="page" [routerLinkActiveOptions]="{ exact: true }"
          class="text-text-muted border-b-2 border-transparent py-1">Inicio</a>
        <a routerLink="/mis-modelos" routerLinkActive="!text-text border-text" ariaCurrentWhenActive="page"
          class="text-text-muted border-b-2 border-transparent py-1">Mis modelos</a>
        <a routerLink="/galeria" routerLinkActive="!text-text border-text" ariaCurrentWhenActive="page"
          class="text-text-muted border-b-2 border-transparent py-1">Galería</a>
        <a routerLink="/precios" routerLinkActive="!text-text border-text" ariaCurrentWhenActive="page"
          class="text-text-muted border-b-2 border-transparent py-1">Precios</a>
      </div>

      <div class="ml-auto flex items-center gap-2">
        @if (gates.me(); as me) {
          @if (me.generations; as g) {
            <!-- tienda: lo que importa es cuántos modelos gratis quedan hoy y los pedidos -->
            @if (me.isAdmin) { <a routerLink="/taller" class="btn btn-sm btn-ghost">Taller</a> }
            <a routerLink="/pedidos" class="btn btn-sm btn-ghost">Mis pedidos</a>
            @if (g.perDay) {
              <span class="hidden sm:inline text-xs text-text-muted figures" [attr.aria-label]="'Modelos gratis que te quedan hoy: ' + remaining(g)">
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
            @for (l of links; track l.path) {
              <li><a [routerLink]="l.path" (click)="close(siteMenu)" routerLinkActive="bg-surface-3" ariaCurrentWhenActive="page"
                [routerLinkActiveOptions]="{ exact: l.path === '/' }" class="block p-3 rounded-md hover:bg-surface-3">{{ l.label }}</a></li>
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
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly createMenu = viewChild.required<ElementRef<HTMLElement>>('createMenu');
  protected readonly links = [
    { path: '/', label: 'Inicio' }, { path: '/crear', label: 'Crear' }, { path: '/mis-modelos', label: 'Mis modelos' },
    { path: '/galeria', label: 'Galería' }, { path: '/precios', label: 'Precios' },
  ];

  protected remaining(g: { perDay: number | null; today: number }): number {
    return Math.max(0, (g.perDay ?? 0) - g.today);
  }

  /** Navegar dentro de la SPA no cierra el popover solo: se cierra al elegir un enlace. */
  protected close(popover: HTMLElement): void {
    if (popover.matches(':popover-open, .\\:popover-open')) popover.hidePopover();
  }

  /**
   * Sin CSS Anchor Positioning el popover flotante quedaría centrado en la pantalla, lejos de su botón:
   * se coloca debajo del botón, se sube si no cabe y se limita al ancho de la ventana (guía navbar, Fallbacks).
   */
  protected placeCreateMenu(e: Event): void {
    if ((e as ToggleEvent).newState !== 'open' || CSS.supports('position-area', 'block-end')) return;
    const menu = this.createMenu().nativeElement;
    const trigger = this.host.nativeElement.querySelector('.nav-anchor-create') as HTMLElement;
    const t = trigger.getBoundingClientRect();
    const size = menu.getBoundingClientRect();
    let top = t.bottom + 8;
    if (top + size.height > innerHeight) top = Math.max(8, t.top - size.height - 8);
    const left = Math.min(Math.max(0, t.left), innerWidth - size.width);
    Object.assign(menu.style, { top: `${top}px`, left: `${left}px` });
  }
}
