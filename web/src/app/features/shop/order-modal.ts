import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Router } from '@angular/router';
import { Modal } from '../../ui/modal';
import { Icon } from '../../ui/icon';
import { Api, ApiError, Asset, Catalog, SizeId } from '../../data/api';
import { Toasts } from '../../ui/toast';

/** Pedir la figura impresa: tamaño, color, peana y cantidad. Paga en Stripe (o en la página de demostración). */
@Component({
  selector: 'app-order-modal',
  imports: [Modal, Icon, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-modal [open]="!!asset()" heading="Pedir la figura impresa" size="md" (closed)="closed.emit()">
      @if (cat(); as c) {
        <fieldset class="flex flex-col gap-2">
          <legend class="text-sm mb-2">Tamaño</legend>
          <div class="grid grid-cols-3 gap-2">
            @for (s of c.sizes; track s.id) {
              <label class="flex flex-col items-center gap-1 p-3 rounded-md border cursor-pointer text-center focus-ring-within"
                [class.border-highlight]="size() === s.id" [class.bg-highlight-surface]="size() === s.id" [class.border-border]="size() !== s.id">
                <input type="radio" name="size" class="sr-only" [value]="s.id" [checked]="size() === s.id" (change)="size.set(s.id)" />
                <span class="text-sm font-semibold">{{ s.name }}</span>
                <span class="text-xs text-text-muted figures">{{ s.heightMm / 10 }} cm de alto</span>
                <span class="text-sm figures">{{ s.priceCents / 100 | currency: 'EUR' : 'symbol' : '1.2-2' : 'es' }}</span>
              </label>
            }
          </div>
        </fieldset>

        <fieldset class="flex flex-col gap-2">
          <legend class="text-sm mb-2">Color <span class="text-text-muted">· {{ colorName() }}</span></legend>
          <div class="flex flex-wrap gap-2">
            @for (k of c.colors; track k.id) {
              <label class="cursor-pointer" [title]="k.name">
                <input type="radio" name="color" class="sr-only peer" [value]="k.id" [checked]="color() === k.id" (change)="color.set(k.id)"
                  [attr.aria-label]="k.name" />
                <span class="block w-9 h-9 rounded-full border-2 peer-focus-visible:outline peer-focus-visible:outline-2"
                  [style.background]="k.hex" [class.border-text]="color() === k.id" [class.border-border]="color() !== k.id"
                  [class.ring-2]="color() === k.id" [class.ring-offset-2]="color() === k.id" [class.ring-offset-surface-2]="color() === k.id"></span>
              </label>
            }
          </div>
          <p class="hint">Se imprime en un solo color, sin pintar.</p>
        </fieldset>

        <div class="flex flex-wrap items-center justify-between gap-4">
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" [checked]="base()" (change)="base.set(!base())" /> Con peana redonda (gratis)
          </label>
          <label class="flex items-center gap-2 text-sm">Cantidad
            <select class="field h-9 px-2" [value]="quantity()" (change)="quantity.set(+$any($event.target).value)">
              @for (n of qtys(); track n) { <option [value]="n">{{ n }}</option> }
            </select>
          </label>
        </div>

        <dl class="rounded-md bg-surface p-3 text-sm flex flex-col gap-1 figures">
          <div class="flex justify-between"><dt>Figura × {{ quantity() }}</dt><dd>{{ subtotal() / 100 | currency: 'EUR' : 'symbol' : '1.2-2' : 'es' }}</dd></div>
          <div class="flex justify-between"><dt>Envío a domicilio (España)</dt><dd>{{ c.shippingCents / 100 | currency: 'EUR' : 'symbol' : '1.2-2' : 'es' }}</dd></div>
          <div class="flex justify-between font-semibold border-t border-border pt-1 mt-1"><dt>Total, IVA incluido</dt><dd>{{ total() / 100 | currency: 'EUR' : 'symbol' : '1.2-2' : 'es' }}</dd></div>
        </dl>
        <p class="hint">La imprimimos y te la enviamos en {{ c.deliveryDays.min }}–{{ c.deliveryDays.max }} días laborables. La dirección se pide al pagar.</p>
        @if (error()) { <p class="error-text" role="alert">{{ error() }}</p> }
        <div class="flex justify-end gap-2">
          <button type="button" class="btn btn-secondary" (click)="closed.emit()">Cancelar</button>
          <button type="button" class="btn btn-primary" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="pay()">
            @if (busy()) { <ui-icon name="loader-circle" class="animate-spin" /> Preparando el pago… }
            @else { Pagar {{ total() / 100 | currency: 'EUR' : 'symbol' : '1.2-2' : 'es' }} }
          </button>
        </div>
      } @else if (error()) {
        <p class="error-text" role="alert">{{ error() }}</p>
      } @else {
        <div class="skeleton h-48" aria-busy="true"></div>
      }
    </ui-modal>
  `,
})
export class OrderModal {
  readonly asset = input<Asset | null>(null);
  readonly closed = output<void>();
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  protected readonly cat = signal<Catalog | null>(null);
  protected readonly size = signal<SizeId>('m');
  protected readonly color = signal('gris');
  protected readonly base = signal(false);
  protected readonly quantity = signal(1);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly qtys = computed(() => Array.from({ length: this.cat()?.maxQuantity ?? 1 }, (_, i) => i + 1));
  protected readonly colorName = computed(() => this.cat()?.colors.find((c) => c.id === this.color())?.name ?? '');
  protected readonly subtotal = computed(() => (this.cat()?.sizes.find((s) => s.id === this.size())?.priceCents ?? 0) * this.quantity());
  protected readonly total = computed(() => this.subtotal() + (this.cat()?.shippingCents ?? 0));

  constructor() {
    effect(() => {
      if (!this.asset()) return;
      untracked(() => {
        this.error.set('');
        if (!this.cat()) {
          this.api.catalog().then((c) => this.cat.set(c),
            (e) => this.error.set(e instanceof ApiError ? e.message : 'No se ha podido cargar la tienda'));
        }
      });
    });
  }

  protected async pay(): Promise<void> {
    const a = this.asset();
    if (!a || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const { order, url } = await this.api.createOrder({
        assetId: a.id, size: this.size(), color: this.color(), base: this.base(), quantity: this.quantity(),
      });
      const local = url.startsWith(location.origin);
      if (local) {
        // pago de demostración (desarrollo sin Stripe): la página del pedido lo simula
        this.closed.emit();
        await this.router.navigate(['/pedidos', order.id], { queryParams: { pago: 'demo' } });
      } else {
        location.assign(url); // Stripe Checkout; vuelve a /pedidos/:id?pago=ok
      }
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'No se ha podido preparar el pago');
      if (!(e instanceof ApiError)) this.toasts.show('error', 'No se ha podido preparar el pago');
    } finally {
      this.busy.set(false);
    }
  }
}
