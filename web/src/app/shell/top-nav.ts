import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { Icon } from '../ui/icon';
import { Gates } from './gates';
import { Api } from '../data/api';

@Component({
  selector: 'app-top-nav',
  imports: [RouterLink, RouterLinkActive, Icon, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav aria-label="Principal"
      class="h-nav mx-3 mt-3 rounded-pill bg-surface/90 backdrop-blur border border-border shadow-float flex items-center gap-2 sm:gap-4 px-2 sm:px-3">
      <a routerLink="/" class="flex items-center gap-2 pr-2 rounded-pill" aria-label="Inicio">
        <span class="w-8 h-8 rounded-full bg-accent text-on-accent grid place-items-center text-xs font-bold">FM</span>
        <span class="hidden sm:inline text-sm font-semibold">Forma</span>
      </a>

      <div class="relative">
        <button #createBtn type="button" class="btn btn-sm btn-secondary" [attr.aria-expanded]="menu()" aria-haspopup="menu"
          aria-controls="create-menu" (click)="menu.set(!menu())" (keydown.arrowDown)="openMenu($event)">
          Crear <ui-icon name="chevron-down" />
        </button>
        @if (menu()) {
          <div id="create-menu" role="menu" #menuEl (keydown)="menuKeys($event)"
            class="absolute left-0 top-10 z-40 w-60 panel shadow-pop p-1 flex flex-col">
            <a role="menuitem" routerLink="/crear" [queryParams]="{ serie: 'hd' }" (click)="menu.set(false)"
              class="flex items-center gap-3 p-2 rounded-md hover:bg-surface-3 focus:bg-surface-3 outline-none text-sm">
              <ui-icon name="gem" /> Alto detalle</a>
            <a role="menuitem" routerLink="/crear" [queryParams]="{ serie: 'smart' }" (click)="menu.set(false)"
              class="flex items-center gap-3 p-2 rounded-md hover:bg-surface-3 focus:bg-surface-3 outline-none text-sm">
              <ui-icon name="grid-3x3" /> Topología limpia</a>
          </div>
        }
      </div>

      <div class="hidden md:flex items-center gap-4 text-sm">
        <a routerLink="/" routerLinkActive="!text-text border-text" [routerLinkActiveOptions]="{ exact: true }"
          class="text-text-muted border-b-2 border-transparent py-1">Inicio</a>
        <a routerLink="/mis-modelos" routerLinkActive="!text-text border-text"
          class="text-text-muted border-b-2 border-transparent py-1">Mis modelos</a>
        <a routerLink="/galeria" routerLinkActive="!text-text border-text"
          class="text-text-muted border-b-2 border-transparent py-1">Galería</a>
        <a routerLink="/precios" routerLinkActive="!text-text border-text"
          class="text-text-muted border-b-2 border-transparent py-1">Precios</a>
      </div>

      <div class="ml-auto flex items-center gap-2">
        @if (gates.me(); as me) {
          <a routerLink="/cuenta" class="btn btn-sm btn-ghost" [attr.aria-label]="'Créditos disponibles: ' + me.credits.available">
            <ui-icon name="zap" /> {{ me.credits.available | number: '1.0-0' : 'es' }}
          </a>
          <a routerLink="/cuenta" class="w-8 h-8 rounded-full bg-surface-3 grid place-items-center text-xs uppercase"
            [attr.aria-label]="'Tu cuenta (' + me.profile.email + ')'">{{ me.profile.displayName.slice(0, 2) }}</a>
        } @else {
          <button type="button" class="btn btn-sm btn-primary" (click)="gates.ensureSignedIn()">Entrar</button>
        }
        <button type="button" class="btn btn-icon md:hidden" aria-label="Abrir menú" [attr.aria-expanded]="sheet()"
          (click)="sheet.set(!sheet())"><ui-icon name="menu" /></button>
      </div>
    </nav>

    @if (sheet()) {
      <div class="md:hidden mx-3 mt-2 panel shadow-pop p-2 flex flex-col text-sm">
        @for (l of links; track l.path) {
          <a [routerLink]="l.path" (click)="sheet.set(false)" class="p-3 rounded-md hover:bg-surface-3">{{ l.label }}</a>
        }
      </div>
    }
  `,
})
export class TopNav {
  protected readonly gates = inject(Gates);
  protected readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly menu = signal(false);
  protected readonly sheet = signal(false);
  private readonly createBtn = viewChild.required<ElementRef<HTMLButtonElement>>('createBtn');
  protected readonly links = [
    { path: '/', label: 'Inicio' }, { path: '/crear', label: 'Crear' }, { path: '/mis-modelos', label: 'Mis modelos' },
    { path: '/galeria', label: 'Galería' }, { path: '/precios', label: 'Precios' },
  ];

  @HostListener('document:click', ['$event'])
  protected outside(e: MouseEvent): void {
    if (!this.host.nativeElement.contains(e.target as Node)) this.menu.set(false);
  }

  protected openMenu(e: Event): void {
    e.preventDefault();
    this.menu.set(true);
    setTimeout(() => this.items()[0]?.focus());
  }

  private items(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll('[role="menuitem"]'));
  }

  protected menuKeys(e: KeyboardEvent): void {
    const items = this.items();
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
    else if (e.key === 'Escape') {
      this.menu.set(false);
      this.createBtn().nativeElement.focus();
    } else return;
    e.preventDefault();
  }
}
