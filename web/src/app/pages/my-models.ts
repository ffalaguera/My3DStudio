import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { switchMap, debounceTime } from 'rxjs';
import { Api, ApiError, Asset, AssetFilter } from '../data/api';
import { Icon } from '../ui/icon';
import { Modal } from '../ui/modal';
import { Toasts } from '../ui/toast';
import { Gates } from '../shell/gates';
import { ExportModal } from '../features/workspace/export-modal';
import { OrderModal } from '../features/shop/order-modal';

type Chip = 'all' | 'hd' | 'smart' | 'textured' | 'untextured';

/** S06: biblioteca del usuario con búsqueda, filtros, exportar, privacidad y borrar. */
@Component({
  selector: 'app-my-models',
  imports: [RouterLink, Icon, Modal, FormsModule, DatePipe, ExportModal, OrderModal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="max-w-content mx-auto px-4 py-8 flex flex-col gap-6">
      <div class="flex flex-wrap items-end gap-4">
        <div class="flex-1 min-w-60">
          <h1 class="text-xl">Mis modelos</h1>
          @if (gates.me(); as me) {
            <p class="text-sm text-text-muted">
              {{ me.usage.savedModels }}{{ me.plan.maxSavedModels !== null ? ' de ' + me.plan.maxSavedModels : '' }} modelos
              @if (me.plan.historyDays) { · se guardan {{ me.plan.historyDays === 1 ? '1 día' : me.plan.historyDays + ' días' }} en tu plan }
            </p>
          }
        </div>
        <label class="flex items-center gap-2 h-10 px-3 field w-full sm:w-72">
          <ui-icon name="search" class="text-text-muted" />
          <span class="sr-only">Buscar en tus modelos</span>
          <input class="bg-transparent outline-none flex-1 text-sm placeholder:text-text-muted" placeholder="Busca por nombre"
            [ngModel]="q()" (ngModelChange)="q.set($event)" />
          @if (q()) { <button type="button" class="btn btn-icon h-6 w-6" aria-label="Borrar búsqueda" (click)="q.set('')"><ui-icon name="x" [size]="14" /></button> }
        </label>
      </div>

      <div class="flex flex-wrap gap-2" role="group" aria-label="Filtros">
        @for (c of chips; track c.id) {
          <button type="button" class="chip" [attr.aria-pressed]="chip() === c.id" (click)="chip.set(c.id)">{{ c.label }}</button>
        }
      </div>

      @if (!gates.me()) {
        <div class="card p-10 flex flex-col items-center gap-3 text-center">
          <ui-icon name="box" [size]="32" class="text-text-muted" />
          <p class="text-lg">Entra para ver tus modelos</p>
          <button type="button" class="btn btn-primary" (click)="gates.ensureSignedIn()">Entrar</button>
        </div>
      } @else if (!assets()) {
        <ul class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" aria-busy="true">
          @for (i of [1, 2, 3, 4, 5]; track i) { <li class="skeleton aspect-[4/5]"></li> }
        </ul>
      } @else if (!assets()!.length) {
        <div class="card p-10 flex flex-col items-center gap-3 text-center">
          <ui-icon name="box" [size]="32" class="text-text-muted" />
          @if (q() || chip() !== 'all') {
            <p class="text-lg">Nada coincide con tu búsqueda</p>
            <button type="button" class="btn btn-secondary" (click)="q.set(''); chip.set('all')">Quitar filtros</button>
          } @else {
            <p class="text-lg">Aún no tienes modelos</p>
            <p class="text-sm text-text-muted">Sube una foto o describe una idea. Verás el coste antes de generar</p>
            <a routerLink="/crear" class="btn btn-primary">Crear modelo</a>
          }
        </div>
      } @else {
        <ul class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          @for (a of assets(); track a.id) {
            <li class="card overflow-hidden relative group">
              <a [routerLink]="['/crear']" [queryParams]="{ modelo: a.id }" class="block focus-visible:outline-none">
                @if (a.thumbnailUrl) { <img [src]="a.thumbnailUrl" [alt]="a.name" class="aspect-square w-full object-cover" /> }
                @else { <span class="block aspect-square viewport-bg"></span> }
                <span class="block p-3">
                  <span class="block text-sm truncate" [title]="a.name">{{ a.name }}</span>
                  <span class="block text-xs text-text-muted">{{ a.series === 'hd' ? 'Alto detalle' : 'Topología limpia' }} · {{ a.createdAt | date: 'd MMM' : undefined : 'es' }}</span>
                </span>
              </a>
              <div class="absolute left-2 top-2 flex gap-1">
                @if (a.privacy === 'private') { <span class="badge"><ui-icon name="lock" [size]="12" /> <span class="sr-only">Privado</span></span> }
                @if (expiresSoon(a)) { <span class="badge text-warning">Se borra {{ a.expiresAt | date: 'd MMM, HH:mm' : undefined : 'es' }}</span> }
              </div>
              <div class="absolute right-2 top-2">
                <button type="button" class="btn btn-icon bg-surface-2/90" [attr.aria-label]="'Acciones de ' + a.name"
                  aria-haspopup="menu" [attr.aria-expanded]="menuFor() === a.id" (click)="menuFor.set(menuFor() === a.id ? null : a.id)">
                  <ui-icon name="ellipsis" /></button>
                @if (menuFor() === a.id) {
                  <div role="menu" class="absolute right-0 top-9 z-20 w-48 panel shadow-pop p-1 flex flex-col text-sm" (keydown.escape)="menuFor.set(null)">
                    @if (shop()) {
                      <button role="menuitem" type="button" class="flex items-center gap-2 p-2 rounded-md hover:bg-surface-3" (click)="ordering.set(a); menuFor.set(null)"><ui-icon name="box" /> Pedir impresa</button>
                    } @else {
                      <button role="menuitem" type="button" class="flex items-center gap-2 p-2 rounded-md hover:bg-surface-3" (click)="exporting.set(a); menuFor.set(null)"><ui-icon name="download" /> Exportar</button>
                      <button role="menuitem" type="button" class="flex items-center gap-2 p-2 rounded-md hover:bg-surface-3" (click)="togglePrivacy(a)">
                        <ui-icon [name]="a.privacy === 'public' ? 'lock' : 'globe'" /> {{ a.privacy === 'public' ? 'Hacer privado' : 'Hacer público' }}</button>
                    }
                    <button role="menuitem" type="button" class="flex items-center gap-2 p-2 rounded-md hover:bg-surface-3 text-danger" (click)="deleting.set(a); menuFor.set(null)"><ui-icon name="trash-2" /> Borrar</button>
                  </div>
                }
              </div>
            </li>
          }
        </ul>
      }
    </div>

    <ui-modal [open]="!!deleting()" heading="¿Borrar este modelo?" (closed)="deleting.set(null)">
      <p class="text-sm text-text-muted">Se borrarán «{{ deleting()?.name }}» y todos sus archivos. No se puede deshacer.</p>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn btn-secondary" autofocus (click)="deleting.set(null)">Cancelar</button>
        <button type="button" class="btn btn-danger" (click)="remove()">Borrar</button>
      </div>
    </ui-modal>
    <app-export-modal [asset]="exporting()" (closed)="exporting.set(null)" />
    <app-order-modal [asset]="ordering()" (closed)="ordering.set(null)" />
  `,
})
export class MyModels {
  private readonly api = inject(Api);
  protected readonly gates = inject(Gates);
  private readonly toasts = inject(Toasts);
  protected readonly q = signal('');
  protected readonly chip = signal<Chip>('all');
  protected readonly menuFor = signal<string | null>(null);
  protected readonly deleting = signal<Asset | null>(null);
  protected readonly exporting = signal<Asset | null>(null);
  protected readonly ordering = signal<Asset | null>(null);
  protected readonly shop = signal(true);
  private readonly caps = this.api.capabilities().then((c) => this.shop.set(c.businessModel === 'shop'));
  protected readonly chips: { id: Chip; label: string }[] = [
    { id: 'all', label: 'Todo' }, { id: 'hd', label: 'Alto detalle' }, { id: 'smart', label: 'Topología limpia' },
    { id: 'textured', label: 'Con textura' }, { id: 'untextured', label: 'Sin textura' },
  ];

  private readonly filter = computed<AssetFilter>(() => {
    const c = this.chip();
    return {
      q: this.q(),
      series: c === 'hd' || c === 'smart' ? c : undefined,
      hasTexture: c === 'textured' ? true : c === 'untextured' ? false : undefined,
    };
  });
  protected readonly assets = toSignal(
    toObservable(this.filter).pipe(debounceTime(150), switchMap((f) => this.api.assets(f))),
  );

  protected expiresSoon(a: Asset): boolean {
    return !!a.expiresAt && new Date(a.expiresAt).getTime() - Date.now() < 2 * 86400000;
  }

  protected async togglePrivacy(a: Asset): Promise<void> {
    this.menuFor.set(null);
    try {
      await this.api.updateAsset(a.id, { privacy: a.privacy === 'public' ? 'private' : 'public' });
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) this.gates.showPaywall('plan_feature', e.message);
      else this.toasts.show('error', 'No se ha podido cambiar la visibilidad');
    }
  }

  protected async remove(): Promise<void> {
    const a = this.deleting();
    if (!a) return;
    this.deleting.set(null);
    await this.api.deleteAsset(a.id);
    this.toasts.show('success', `Has borrado «${a.name}»`);
  }
}
