import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api, Catalog } from '../data/api';
import { Icon } from '../ui/icon';
import { type Lid } from '../data/lids';

/** Precios de la tienda: tamaños con su precio en la tapa, colores, peana y envío. */
@Component({
  selector: 'app-shop-prices',
  imports: [CurrencyPipe, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ground-primer -mt-[3.75rem] pt-[3.75rem] min-h-[calc(100svh-3.75rem)]">
      <div class="max-w-[80rem] mx-auto px-4 sm:px-8 py-12 sm:py-16 flex flex-col gap-10">
        <div class="flex flex-col gap-3 max-w-[48ch]">
          <h1 class="font-display uppercase text-[3rem] sm:text-[4.25rem] leading-[0.9]">Precios</h1>
          <p class="text-sm sm:text-base">Crear y revisar el modelo 3D es gratis. Pagas la figura impresa según su tamaño, con IVA, más el envío.</p>
        </div>
        @if (cat(); as c) {
          <ul class="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-10">
            @for (z of c.sizes; track z.id; let i = $index) {
              <li class="flex flex-col items-center text-center gap-3">
                <span class="pot-lid w-36 h-36 rounded-full grid place-items-center" [attr.data-lid]="lids[i % lids.length]">
                  <span class="flex flex-col items-center leading-none figures">
                    <span class="font-display text-[2.25rem] font-extrabold">{{ z.priceCents / 100 | currency: 'EUR' : 'symbol' : '1.2-2' : 'es' }}</span>
                    <span class="text-xs font-semibold pt-1">{{ z.heightMm / 10 }} cm</span>
                  </span>
                </span>
                <span class="font-display text-[1.5rem] font-extrabold uppercase leading-none">{{ z.name }}</span>
                <span class="text-sm figures">{{ z.heightMm }} mm de alto</span>
              </li>
            }
          </ul>
          <dl class="ground-bone px-5 sm:px-8 py-4 shadow-[0_12px_32px_rgb(0_0_0/0.35)] max-w-[44rem]">
            <div class="grid sm:grid-cols-[11rem_1fr] gap-x-6 gap-y-1 py-3">
              <dt class="font-display text-[1.375rem] font-extrabold uppercase leading-none">Colores</dt>
              <dd class="flex flex-wrap gap-3 text-sm">
                @for (k of c.colors; track k.id) {
                  <span class="flex items-center gap-1.5"><span class="w-4 h-4 rounded-full border border-ink/40" [style.background]="k.hex"></span>{{ k.name }}</span>
                }
              </dd>
            </div>
            <div class="grid sm:grid-cols-[11rem_1fr] gap-x-6 gap-y-1 py-3 border-t keyline">
              <dt class="font-display text-[1.375rem] font-extrabold uppercase leading-none">Peana</dt>
              <dd class="text-sm">Redonda, de 2 mm, sin coste. La eliges al pedir.</dd>
            </div>
            <div class="grid sm:grid-cols-[11rem_1fr] gap-x-6 gap-y-1 py-3 border-t keyline">
              <dt class="font-display text-[1.375rem] font-extrabold uppercase leading-none">Envío</dt>
              <dd class="text-sm figures">{{ c.shippingCents / 100 | currency: 'EUR' : 'symbol' : '1.2-2' : 'es' }} por pedido, a toda España.
                Llega en {{ c.deliveryDays.min }}–{{ c.deliveryDays.max }} días laborables.</dd>
            </div>
            <div class="grid sm:grid-cols-[11rem_1fr] gap-x-6 gap-y-1 py-3 border-t keyline">
              <dt class="font-display text-[1.375rem] font-extrabold uppercase leading-none">Cantidad</dt>
              <dd class="text-sm">Hasta {{ c.maxQuantity }} copias por pedido, con un solo envío.</dd>
            </div>
          </dl>
        } @else {
          <div class="skeleton h-48" aria-busy="true"></div>
        }
        <a routerLink="/crear" class="btn btn-primary btn-lg self-start">Crear mi figura · gratis <ui-icon name="arrow-right" /></a>
      </div>
    </section>
  `,
})
export class ShopPrices {
  private readonly api = inject(Api);
  protected readonly cat = signal<Catalog | null>(null);
  protected readonly lids: Lid[] = ['red', 'mustard', 'blue'];

  constructor() {
    void this.api.catalog().then((c) => this.cat.set(c)).catch(() => {});
  }
}
