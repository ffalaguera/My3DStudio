import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Api, ApiError, PlanLimits } from '../data/api';
import { Icon } from '../ui/icon';
import { Modal } from '../ui/modal';
import { Gates } from '../shell/gates';
import { Toasts } from '../ui/toast';

/** S10 precios. S11 checkout: con la API falsa es una confirmación de pago simulado, sin cobro. */
@Component({
  selector: 'app-pricing',
  imports: [Icon, Modal, CurrencyPipe, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="max-w-content mx-auto px-4 py-10 flex flex-col items-center gap-8">
      <div class="text-center flex flex-col gap-2">
        <h1 class="text-xl sm:text-display">Planes</h1>
        <p class="text-text-muted">Paga por los créditos que necesitas. Si una generación falla, no se cobra.</p>
      </div>

      <div role="radiogroup" aria-label="Facturación" class="seg">
        <button type="button" role="radio" [attr.aria-checked]="interval() === 'month'" (click)="interval.set('month')">Mensual</button>
        <button type="button" role="radio" [attr.aria-checked]="interval() === 'year'" (click)="interval.set('year')">Anual <span class="text-success text-xs">ahorra más</span></button>
      </div>

      @if (!plans().length) {
        <div class="grid sm:grid-cols-3 gap-4 w-full" aria-busy="true">@for (i of [1, 2, 3]; track i) { <div class="skeleton h-96 rounded-xl"></div> }</div>
      } @else {
        <ul class="grid md:grid-cols-3 gap-4 w-full">
          @for (p of plans(); track p.id) {
            @let current = gates.me()?.plan?.id === p.id;
            <li class="rounded-xl bg-surface p-6 flex flex-col gap-4 relative" [class.border]="p.id === 'pro'" [class.border-highlight]="p.id === 'pro'">
              @if (p.id === 'pro') { <span class="absolute -top-3 left-6 text-xs px-2 rounded-pill bg-highlight text-on-accent">La más elegida</span> }
              <h2 class="text-lg">{{ p.name }}</h2>
              <p>
                <span class="text-xl">{{ monthly(p) / 100 | currency: 'EUR' : 'symbol' : '1.0-2' : 'es' }}</span>
                <span class="text-sm text-text-muted"> /mes</span>
                @if (interval() === 'year' && p.priceYearCents) {
                  <span class="block text-xs text-text-muted">{{ p.priceYearCents / 100 | currency: 'EUR' : 'symbol' : '1.0-0' : 'es' }} al año</span>
                }
              </p>
              <ul class="text-sm text-text-muted flex flex-col gap-2 flex-1">
                <li class="flex gap-2"><ui-icon name="zap" class="text-text" /> {{ p.monthlyCredits | number: '1.0-0' : 'es' }} créditos al mes</li>
                <li class="flex gap-2"><ui-icon name="layers" class="text-text" /> {{ p.maxConcurrentTasks }} {{ p.maxConcurrentTasks === 1 ? 'tarea' : 'tareas' }} a la vez</li>
                <li class="flex gap-2"><ui-icon [name]="p.allowSmartMesh ? 'check' : 'minus'" class="text-text" /> Topología limpia{{ p.allowSmartMesh ? '' : ' (no incluida)' }}</li>
                <li class="flex gap-2"><ui-icon name="image" class="text-text" /> Texturas hasta {{ p.maxTextureResolution.toUpperCase() }}</li>
                <li class="flex gap-2"><ui-icon [name]="p.allowPrivate ? 'lock' : 'globe'" class="text-text" /> {{ p.allowPrivate ? 'Modelos privados y uso comercial' : 'Modelos públicos, con atribución' }}</li>
                <li class="flex gap-2"><ui-icon name="history" class="text-text" /> Historial {{ p.historyDays === null ? 'permanente' : p.historyDays === 1 ? 'de 1 día' : 'de ' + p.historyDays + ' días' }}</li>
                <li class="flex gap-2"><ui-icon name="download" class="text-text" /> {{ p.monthlyExportLimit === null ? 'Exportaciones ilimitadas' : p.monthlyExportLimit + ' exportaciones al mes' }}</li>
              </ul>
              @if (current) {
                <button type="button" class="btn btn-secondary" disabled>Tu plan</button>
              } @else if (p.priceMonthCents === 0) {
                <button type="button" class="btn btn-secondary" (click)="gates.ensureSignedIn()" [disabled]="!!gates.me()">Empezar gratis</button>
              } @else {
                <button type="button" class="btn btn-primary" (click)="choose(p)">Elegir {{ p.name }}</button>
              }
            </li>
          }
        </ul>
      }
      <p class="hint text-center">Precios provisionales. Impuestos incluidos.</p>
    </div>

    <ui-modal [open]="!!buying()" heading="Pago simulado" (closed)="buying.set(null)">
      <p class="text-sm">Vas a pasar al plan <strong>{{ buying()?.name }}</strong> ({{ interval() === 'year' ? 'anual' : 'mensual' }}).</p>
      <p class="text-sm text-text-muted">Esta versión no cobra nada: el pago real con Stripe llega con el backend.</p>
      @if (error()) { <p class="error-text" role="alert">{{ error() }}</p> }
      <div class="flex justify-end gap-2">
        <button type="button" class="btn btn-secondary" (click)="buying.set(null)">Cancelar</button>
        <button type="button" class="btn btn-primary" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="confirm()">
          @if (busy()) { <ui-icon name="loader-circle" class="animate-spin" /> Procesando… } @else { Confirmar }
        </button>
      </div>
    </ui-modal>
  `,
})
export class Pricing {
  private readonly api = inject(Api);
  protected readonly gates = inject(Gates);
  private readonly toasts = inject(Toasts);
  protected readonly interval = signal<'month' | 'year'>('year');
  protected readonly plans = signal<PlanLimits[]>([]);
  protected readonly buying = signal<PlanLimits | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  constructor() {
    void this.api.plans().then((p) => this.plans.set(p));
  }

  protected monthly(p: PlanLimits): number {
    return this.interval() === 'year' ? Math.round(p.priceYearCents / 12) : p.priceMonthCents;
  }

  protected async choose(p: PlanLimits): Promise<void> {
    if (!(await this.gates.ensureSignedIn())) return;
    this.error.set('');
    const { billing } = await this.api.capabilities();
    if (billing === 'simulated') return this.buying.set(p); // demo: confirmación sin cobro
    if (billing === 'off') return this.toasts.show('info', 'Los pagos se activan pronto. De momento puedes usar el plan Gratis');
    try {
      await this.api.checkout(p.id, this.interval()); // redirige a Stripe Checkout
    } catch (e) {
      this.toasts.show('error', e instanceof ApiError ? e.message : 'No se ha podido abrir el pago');
    }
  }

  protected async confirm(): Promise<void> {
    const p = this.buying();
    if (!p) return;
    this.busy.set(true);
    try {
      await this.api.checkout(p.id, this.interval());
      this.buying.set(null);
      this.toasts.show('success', `Ya tienes el plan ${p.name}`, { label: 'Crear', link: '/crear' });
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'No se ha podido completar');
    } finally {
      this.busy.set(false);
    }
  }
}
