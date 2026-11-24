import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { Api, ApiError, Order, OrderStatus } from '../data/api';
import { Icon } from '../ui/icon';
import { Gates } from '../shell/gates';
import { Toasts } from '../ui/toast';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: 'Pendiente de pago', paid: 'Pagado · en cola', printing: 'Imprimiendo', shipped: 'Enviado',
  cancelled: 'Cancelado', refunded: 'Reembolsado',
};
const STEPS: OrderStatus[] = ['paid', 'printing', 'shipped'];
export const sizeName = (s: string) => ({ s: 'Pequeña', m: 'Mediana', l: 'Grande' })[s] ?? s;

/** Mis pedidos: figuras compradas y su estado. */
@Component({
  selector: 'app-orders',
  imports: [RouterLink, Icon, CurrencyPipe, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="max-w-content mx-auto px-4 py-8 flex flex-col gap-6">
      <h1 class="text-xl">Mis pedidos</h1>
      @if (!gates.me()) {
        <div class="card p-10 flex flex-col items-center gap-3 text-center">
          <ui-icon name="box" [size]="32" class="text-text-muted" />
          <p class="text-lg">Entra para ver tus pedidos</p>
          <button type="button" class="btn btn-primary" (click)="gates.ensureSignedIn()">Entrar</button>
        </div>
      } @else if (!orders()) {
        <div class="skeleton h-32" aria-busy="true"></div>
      } @else if (!orders()!.length) {
        <div class="card p-10 flex flex-col items-center gap-3 text-center">
          <ui-icon name="box" [size]="32" class="text-text-muted" />
          <p class="text-lg">Aún no has pedido ninguna figura</p>
          <p class="text-sm text-text-muted">Crea tu modelo y pulsa «Pedir impresa» en el visor.</p>
          <a routerLink="/crear" class="btn btn-primary">Crear un modelo</a>
        </div>
      } @else {
        <ul class="flex flex-col gap-2">
          @for (o of orders()!; track o.id) {
            <li>
              <a [routerLink]="['/pedidos', o.id]" class="card p-4 flex flex-wrap items-center gap-4 hover:bg-surface-3">
                <span class="flex-1 min-w-48">
                  <span class="block font-semibold">{{ o.assetName }}</span>
                  <span class="block text-sm text-text-muted figures">{{ sizeName(o.size) }} · {{ o.heightMm / 10 }} cm · {{ o.color }}{{ o.base ? ' · peana' : '' }} · × {{ o.quantity }}</span>
                </span>
                <span class="badge">{{ label[o.status] }}</span>
                <span class="text-sm figures">{{ o.totalCents / 100 | currency: 'EUR' : 'symbol' : '1.2-2' : 'es' }}</span>
                <span class="text-xs text-text-muted">{{ o.createdAt | date: 'd MMM yyyy' : undefined : 'es' }}</span>
              </a>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class Orders {
  protected readonly gates = inject(Gates);
  private readonly api = inject(Api);
  protected readonly orders = signal<Order[] | null>(null);
  protected readonly label = STATUS_LABEL;
  protected readonly sizeName = sizeName;

  constructor() {
    effect(() => {
      if (!this.gates.session()) return;
      untracked(() => this.api.orders().then((o) => this.orders.set(o), () => this.orders.set([])));
    });
  }
}

/** Un pedido: estado, resumen y envío. Con ?pago=demo (desarrollo sin Stripe) permite simular el pago. */
@Component({
  selector: 'app-order-detail',
  imports: [RouterLink, Icon, CurrencyPipe, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="max-w-[44rem] mx-auto px-4 py-8 flex flex-col gap-6">
      <a routerLink="/pedidos" class="text-sm text-text-muted flex items-center gap-1">← Mis pedidos</a>
      @if (error()) {
        <p class="error-text" role="alert">{{ error() }}</p>
      } @else if (order(); as o) {
        <div class="flex flex-col gap-1">
          <h1 class="text-xl">{{ o.assetName }}</h1>
          <p class="text-sm text-text-muted">Pedido {{ o.id.slice(0, 8) }} · {{ o.createdAt | date: 'd MMM yyyy, HH:mm' : undefined : 'es' }}</p>
        </div>

        @if (o.status === 'pending_payment') {
          <div class="panel p-4 flex flex-col gap-3" role="status">
            @if (paymentReturn() === 'ok') {
              <p class="flex items-center gap-2"><ui-icon name="loader-circle" class="animate-spin" /> Confirmando el pago con el banco…</p>
            } @else if (paymentReturn() === 'demo') {
              <p class="text-sm">Pago de demostración: aquí no se cobra nada. En producción esta página es la de Stripe.</p>
              <button type="button" class="btn btn-primary self-start" [disabled]="busy()" (click)="demoPay()">Simular pago</button>
            } @else {
              <p class="text-sm">Este pedido no se ha pagado.</p>
            }
          </div>
        } @else {
          @if (paymentReturn() && o.status === 'paid') {
            <p class="panel p-4 flex items-center gap-2" role="status"><ui-icon name="check" /> ¡Pagado! Ya está en la cola de impresión.</p>
          }
          @if (o.status === 'cancelled' || o.status === 'refunded') {
            <p class="badge self-start">{{ label[o.status] }}</p>
          } @else {
            <ol class="grid grid-cols-3 gap-2 text-sm" aria-label="Estado del pedido">
              @for (s of steps; track s; let i = $index) {
                <li class="flex flex-col gap-1 border-t-4 pt-2" [class.border-accent]="reached(o.status, i)" [class.border-border]="!reached(o.status, i)"
                  [attr.aria-current]="o.status === s ? 'step' : null">
                  <span [class.font-semibold]="o.status === s">{{ label[s] }}</span>
                </li>
              }
            </ol>
          }
          @if (o.tracking) { <p class="text-sm">Seguimiento del envío: <span class="figures font-semibold">{{ o.tracking }}</span></p> }
        }

        <dl class="card p-4 text-sm grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 figures">
          <dt class="text-text-muted">Tamaño</dt><dd>{{ sizeName(o.size) }} · {{ o.heightMm / 10 }} cm de alto</dd>
          <dt class="text-text-muted">Color</dt><dd>{{ o.color }}</dd>
          <dt class="text-text-muted">Peana</dt><dd>{{ o.base ? 'Sí' : 'No' }}</dd>
          <dt class="text-text-muted">Cantidad</dt><dd>{{ o.quantity }}</dd>
          <dt class="text-text-muted">Envío</dt><dd>{{ o.shippingCents / 100 | currency: 'EUR' : 'symbol' : '1.2-2' : 'es' }}</dd>
          <dt class="text-text-muted">Total</dt><dd class="font-semibold">{{ o.totalCents / 100 | currency: 'EUR' : 'symbol' : '1.2-2' : 'es' }}</dd>
          @if (o.shipping?.address; as ad) {
            <dt class="text-text-muted">Se envía a</dt>
            <dd>{{ o.shipping?.name }}<br />{{ ad.line1 }}{{ ad.line2 ? ', ' + ad.line2 : '' }}<br />{{ ad.postal_code }} {{ ad.city }}</dd>
          }
        </dl>
        <p class="hint">¿Algún problema con tu figura? Escríbenos y lo arreglamos.</p>
      } @else {
        <div class="skeleton h-48" aria-busy="true"></div>
      }
    </div>
  `,
})
export class OrderDetail {
  private readonly api = inject(Api);
  private readonly gates = inject(Gates);
  private readonly toasts = inject(Toasts);
  private readonly route = inject(ActivatedRoute);
  private readonly params = toSignal(this.route.paramMap, { requireSync: true });
  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });
  protected readonly paymentReturn = computed(() => this.query().get('pago'));
  protected readonly order = signal<Order | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly label = STATUS_LABEL;
  protected readonly steps = STEPS;
  protected readonly sizeName = sizeName;
  private timer = 0;

  constructor() {
    effect((onCleanup) => {
      const id = this.params().get('id')!;
      if (!this.gates.session()) return;
      let tries = 0;
      const load = () => this.api.order(id).then((o) => {
        this.order.set(o);
        // al volver de Stripe el webhook puede tardar unos segundos
        if (o.status === 'pending_payment' && this.paymentReturn() === 'ok' && ++tries < 20) this.timer = window.setTimeout(load, 1500);
      }, (e) => this.error.set(e instanceof ApiError ? e.message : 'No se ha podido cargar el pedido'));
      untracked(load);
      onCleanup(() => clearTimeout(this.timer));
    });
  }

  protected reached(status: OrderStatus, i: number): boolean {
    return STEPS.indexOf(status) >= i;
  }

  protected async demoPay(): Promise<void> {
    const o = this.order();
    if (!o) return;
    this.busy.set(true);
    try {
      this.order.set(await this.api.demoPay(o.id));
    } catch (e) {
      this.toasts.show('error', e instanceof ApiError ? e.message : 'No se ha podido simular el pago');
    } finally {
      this.busy.set(false);
    }
  }
}
