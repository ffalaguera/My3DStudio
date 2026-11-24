import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Api, ApiError, Order, OrderStatus, PrintReport } from '../data/api';
import { Icon } from '../ui/icon';
import { Gates } from '../shell/gates';
import { Toasts } from '../ui/toast';
import { sizeName, STATUS_LABEL } from './orders';

type Filter = 'open' | 'all' | OrderStatus;

/** Taller (solo ADMIN_EMAILS): cola de pedidos pagados, archivo listo para imprimir y estado del envío. */
@Component({
  selector: 'app-workshop',
  imports: [Icon, CurrencyPipe, DatePipe, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="max-w-content mx-auto px-4 py-8 flex flex-col gap-6">
      <div class="flex flex-wrap items-end gap-4">
        <h1 class="text-xl flex-1">Taller</h1>
        <div class="flex flex-wrap gap-2" role="group" aria-label="Filtrar pedidos">
          @for (f of filters; track f.id) {
            <button type="button" class="chip" [attr.aria-pressed]="filter() === f.id" (click)="filter.set(f.id)">{{ f.label }}</button>
          }
        </div>
      </div>

      @if (!gates.me()?.isAdmin) {
        <p class="text-text-muted">Esta página es solo para el taller.</p>
      } @else if (!orders()) {
        <div class="skeleton h-40" aria-busy="true"></div>
      } @else if (!orders()!.length) {
        <p class="card p-8 text-center text-text-muted">No hay pedidos en esta lista.</p>
      } @else {
        <ul class="flex flex-col gap-3">
          @for (o of orders()!; track o.id) {
            <li class="card p-4 flex flex-col gap-3" [attr.data-order]="o.id">
              <div class="flex flex-wrap items-start gap-4">
                <div class="flex-1 min-w-56">
                  <p class="font-semibold">{{ o.assetName }} <span class="text-text-muted font-normal text-sm">· {{ o.id.slice(0, 8) }}</span></p>
                  <p class="text-sm figures">{{ sizeName(o.size) }} · <strong>{{ o.heightMm }} mm</strong> · {{ o.color }}{{ o.base ? ' · con peana' : '' }} · × {{ o.quantity }}</p>
                  <p class="text-xs text-text-muted">Pagado {{ o.paidAt | date: 'd MMM, HH:mm' : undefined : 'es' }} · {{ o.totalCents / 100 | currency: 'EUR' : 'symbol' : '1.2-2' : 'es' }} · {{ o.email }}</p>
                  @if (o.note) { <p class="text-xs text-warning">{{ o.note }}</p> }
                </div>
                <span class="badge">{{ label[o.status] }}</span>
              </div>
              @if (o.shipping?.address; as ad) {
                <p class="text-sm">{{ o.shipping?.name }} · {{ ad.line1 }}{{ ad.line2 ? ', ' + ad.line2 : '' }} · {{ ad.postal_code }} {{ ad.city }} ({{ ad.country }})</p>
              }
              @if (reports()[o.id]; as r) {
                <p class="text-xs figures" [class.text-warning]="!r.watertight">
                  {{ r.sizeMm.x }} × {{ r.sizeMm.y }} × {{ r.sizeMm.z }} mm · {{ r.triangles | number: '1.0-0' : 'es' }} triángulos ·
                  {{ r.watertight ? 'malla cerrada' : r.openEdges + ' bordes abiertos: repárala en el laminador' }}
                </p>
              }
              <div class="flex flex-wrap items-center gap-2">
                <button type="button" class="btn btn-sm btn-secondary" (click)="file(o, '3mf')"><ui-icon name="download" /> 3MF</button>
                <button type="button" class="btn btn-sm btn-secondary" (click)="file(o, 'stl')"><ui-icon name="download" /> STL</button>
                @if (o.status === 'paid') {
                  <button type="button" class="btn btn-sm btn-primary" (click)="set(o, { status: 'printing' })">Empezar a imprimir</button>
                }
                @if (o.status === 'printing') {
                  <label class="flex items-center gap-2 text-sm">
                    <span class="sr-only">Número de seguimiento</span>
                    <input #trk class="field h-8 px-2 w-44" placeholder="Nº de seguimiento" />
                  </label>
                  <button type="button" class="btn btn-sm btn-primary" (click)="set(o, { status: 'shipped', tracking: trk.value || undefined })">Marcar enviado</button>
                }
                @if (o.status === 'paid' || o.status === 'printing') {
                  <button type="button" class="btn btn-sm btn-ghost ml-auto" (click)="cancel(o)">Cancelar</button>
                }
              </div>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class Workshop {
  protected readonly gates = inject(Gates);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  protected readonly filter = signal<Filter>('open');
  protected readonly orders = signal<Order[] | null>(null);
  protected readonly reports = signal<Record<string, PrintReport>>({});
  protected readonly label = STATUS_LABEL;
  protected readonly sizeName = sizeName;
  protected readonly filters: { id: Filter; label: string }[] = [
    { id: 'open', label: 'Por hacer' }, { id: 'shipped', label: 'Enviados' }, { id: 'all', label: 'Todos' },
  ];

  constructor() {
    effect(() => {
      const f = this.filter();
      if (!this.gates.me()?.isAdmin) return;
      untracked(() => this.load(f));
    });
  }

  private load(f: Filter): void {
    this.orders.set(null);
    this.api.adminOrders(f).then((o) => this.orders.set(o), (e) => {
      this.orders.set([]);
      this.toasts.show('error', e instanceof ApiError ? e.message : 'No se han podido cargar los pedidos');
    });
  }

  protected async file(o: Order, format: 'stl' | '3mf'): Promise<void> {
    try {
      const r = await this.api.adminOrderFile(o.id, format);
      this.reports.update((m) => ({ ...m, [o.id]: r.print }));
      const a = document.createElement('a');
      a.href = r.url;
      a.download = r.filename;
      a.click();
    } catch (e) {
      this.toasts.show('error', e instanceof ApiError ? e.message : 'No se ha podido preparar el archivo');
    }
  }

  protected async set(o: Order, patch: { status?: 'printing' | 'shipped' | 'cancelled'; tracking?: string }): Promise<void> {
    try {
      const n = await this.api.adminUpdateOrder(o.id, patch);
      this.orders.update((list) => list?.map((x) => (x.id === o.id ? n : x)) ?? null);
    } catch (e) {
      this.toasts.show('error', e instanceof ApiError ? e.message : 'No se ha podido cambiar el pedido');
    }
  }

  protected cancel(o: Order): void {
    if (confirm(`¿Cancelar el pedido ${o.id.slice(0, 8)}? El reembolso se hace desde Stripe.`)) void this.set(o, { status: 'cancelled' });
  }
}
