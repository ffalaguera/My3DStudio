import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Api, ApiError, CreditPack, PlanLimits } from '../data/api';
import { lidOf } from '../data/lids';
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
    <section aria-labelledby="precios-title" class="">
      <div class="max-w-[80rem] mx-auto px-4 sm:px-8 pt-8 sm:pt-12 pb-12 flex flex-col gap-8">
        <div class="flex flex-wrap items-end justify-between gap-6">
          <div class="flex flex-col gap-3">
            <h1 id="precios-title" class="font-display text-[3.25rem] sm:text-[4.75rem] leading-[1.05]">Precios claros</h1>
            <p class="text-base max-w-[52ch]">Un modelo cuesta {{ perModel }} créditos y lo ves antes de generar. Si falla, te los devolvemos.
              Sin generaciones gratis: todo lo pagas antes, nunca después. Lo que generas se descarga siempre y cancelas sin preguntas.</p>
          </div>
          <div role="radiogroup" aria-label="Facturación" class="inline-flex p-1 rounded-pill bg-ink/90">
            <button type="button" role="radio" [attr.aria-checked]="interval() === 'month'" (click)="interval.set('month')"
              class="h-9 px-4 rounded-pill text-sm font-semibold text-bone aria-checked:bg-bone aria-checked:text-ink">Mensual</button>
            <button type="button" role="radio" [attr.aria-checked]="interval() === 'year'" (click)="interval.set('year')"
              class="h-9 px-4 rounded-pill text-sm font-semibold text-bone aria-checked:bg-bone aria-checked:text-ink">Anual · 2 meses gratis</button>
          </div>
        </div>

        @if (!plans().length) {
          <div class="grid md:grid-cols-3 gap-8" aria-busy="true">@for (i of [1, 2, 3]; track i) { <div class="h-96 rounded-lg bg-primer-deep/60 animate-pulse"></div> }</div>
        } @else {
          <ul class="grid md:grid-cols-3 gap-x-8 gap-y-12 bg-surface border border-border rounded-xl px-6 sm:px-10 py-10">
            @for (p of plans(); track p.id; let i = $index) {
              @let current = gates.me()?.plan?.id === p.id;
              <li class="flex flex-col gap-5">
                <div class="flex items-center gap-4">
                  @let yearly = interval() === 'year' && p.priceYearCents > 0;
                  <span class="w-32 h-32 rounded-full grid place-items-center bg-highlight-surface text-accent shrink-0" [attr.data-lid]="lidOf(p.id)">
                    <span class="flex flex-col items-center leading-none figures">
                      <span class="font-display text-[2.25rem] font-medium">{{ (yearly ? p.priceYearCents : p.priceMonthCents) / 100 | currency: 'EUR' : 'symbol' : '1.0-0' : 'es' }}</span>
                      <span class="text-xs font-semibold pt-1">{{ yearly ? 'al año' : 'al mes' }}</span>
                    </span>
                  </span>
                  <div class="min-w-0">
                    <h2 class="font-display font-medium text-[2.25rem] leading-none">{{ p.name }}</h2>
                    <p class="text-sm pt-1">{{ audience[p.id] ?? '' }}</p>
                    @if (interval() === 'year' && p.priceYearCents) {
                      <p class="text-xs pt-1 figures">Equivale a {{ monthly(p) / 100 | currency: 'EUR' : 'symbol' : '1.0-2' : 'es' }} al mes</p>
                    }
                  </div>
                </div>
                <ul class="text-sm flex flex-col flex-1 figures">
                  @if (p.monthlyCredits) {
                    <li class="flex gap-2 py-2 border-t-2 keyline"><ui-icon name="zap" /> {{ p.monthlyCredits | number: '1.0-0' : 'es' }} créditos al mes (≈ {{ p.monthlyCredits / perModel | number: '1.0-0' : 'es' }} modelos)</li>
                    <li class="flex gap-2 py-2 border-t keyline"><ui-icon name="history" /> Lo que no gastes pasa al mes siguiente</li>
                  } @else {
                    <li class="flex gap-2 py-2 border-t-2 keyline"><ui-icon name="zap" /> Sin créditos incluidos: usa packs desde 3 €</li>
                    <li class="flex gap-2 py-2 border-t keyline"><ui-icon name="history" /> Los créditos de los packs no caducan</li>
                  }
                  <li class="flex gap-2 py-2 border-t keyline"><ui-icon name="layers" /> {{ p.maxConcurrentTasks }} {{ p.maxConcurrentTasks === 1 ? 'tarea' : 'tareas' }} a la vez</li>
                  <li class="flex gap-2 py-2 border-t keyline"><ui-icon [name]="p.allowSmartMesh ? 'check' : 'minus'" /> Topología limpia{{ p.allowSmartMesh ? '' : ' (no incluida)' }}</li>
                  <li class="flex gap-2 py-2 border-t keyline"><ui-icon name="image" /> Texturas hasta {{ p.maxTextureResolution.toUpperCase() }}</li>
                  <li class="flex gap-2 py-2 border-t keyline"><ui-icon [name]="p.allowPrivate ? 'lock' : 'globe'" /> {{ p.allowPrivate ? 'Modelos privados y uso comercial' : 'Modelos públicos, con atribución' }}</li>
                  <li class="flex gap-2 py-2 border-t keyline"><ui-icon name="history" /> Historial {{ p.historyDays === null ? 'permanente' : p.historyDays === 1 ? 'de 1 día' : 'de ' + p.historyDays + ' días' }}</li>
                  <li class="flex gap-2 py-2 border-t keyline"><ui-icon name="download" /> {{ p.monthlyExportLimit === null ? 'Descargas incluidas, sin límite' : p.monthlyExportLimit + ' descargas al mes' }}</li>
                  @if (p.priceMonthCents) { <li class="flex gap-2 py-2 border-t keyline"><ui-icon name="x" /> Cancelas desde tu cuenta, sin preguntas</li> }
                </ul>
                @if (current) {
                  <button type="button" class="btn btn-lg bg-ink/10 text-ink border-2 border-ink" disabled>Tu plan</button>
                } @else if (p.priceMonthCents === 0) {
                  <button type="button" class="btn btn-lg bg-ink text-bone hover:bg-ink-soft" (click)="gates.ensureSignedIn()" [disabled]="!!gates.me()">Crear cuenta</button>
                } @else {
                  <button type="button" class="btn btn-primary btn-lg" (click)="choose(p)">Elegir {{ p.name }}</button>
                }
              </li>
            }
          </ul>
        }
      </div>
    </section>

    <section aria-labelledby="packs-title">
      <div class="max-w-[80rem] mx-auto px-4 sm:px-8 pb-16 flex flex-col gap-8">
        <div class="flex flex-wrap items-end justify-between gap-4 border-t-2 keyline pt-8">
          <h2 id="packs-title" class="section-heading">Packs, sin suscripción</h2>
          <p class="text-sm max-w-[40ch]">Compra créditos una vez. No caducan nunca. El de prueba trae 3 modelos por 3 €.</p>
        </div>
        <ul class="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10">
          @for (k of packs(); track k.id; let i = $index) {
            <li class="flex flex-col items-center text-center gap-3">
              <span class="w-32 h-32 rounded-full grid place-items-center bg-highlight-surface text-accent" [attr.data-lid]="lidOf(k.id)">
                <span class="font-display text-[3rem] font-medium leading-none figures">{{ k.priceCents / 100 | currency: 'EUR' : 'symbol' : '1.0-0' : 'es' }}</span>
              </span>
              <p class="font-display text-[1.5rem] font-medium leading-none figures">{{ k.credits + k.bonusCredits | number: '1.0-0' : 'es' }} créditos</p>
              <p class="text-sm figures">≈ {{ (k.credits + k.bonusCredits) / perModel | number: '1.0-0' : 'es' }} modelos
                @if (k.bonusCredits) { · {{ k.bonusCredits | number: '1.0-0' : 'es' }} de regalo }</p>
              <button type="button" class="btn bg-ink text-bone hover:bg-ink-soft" [disabled]="busyPack() === k.id" [attr.aria-busy]="busyPack() === k.id" (click)="buyPack(k)">
                @if (busyPack() === k.id) { <ui-icon name="loader-circle" class="animate-spin" /> Procesando… } @else { Comprar }
              </button>
            </li>
          }
        </ul>
        <p class="text-xs text-center">IVA incluido. Anual = 10 meses: pagas 10 y usas 12. Te avisamos con 30 días si algún precio cambia.</p>
      </div>
    </section>

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
  protected readonly packs = signal<CreditPack[]>([]);
  protected readonly busyPack = signal<string | null>(null);
  /** Créditos de un modelo de alto detalle (CREDITS_HD del servidor). */
  protected readonly perModel = 50;
  protected readonly audience: Record<string, string> = {
    free: 'Sin cuota: compra packs cuando los necesites',
    pro: 'Para quien crea a menudo: impresión 3D, juegos, AR',
    max: 'Para equipos y estudios con volumen',
  };

  constructor() {
    void this.api.plans().then((p) => this.plans.set(p));
    void this.api.creditPacks().then((k) => this.packs.set(k)).catch(() => this.packs.set([]));
  }

  protected async buyPack(k: CreditPack): Promise<void> {
    if (!(await this.gates.ensureSignedIn())) return;
    const { billing } = await this.api.capabilities();
    if (billing === 'off' || !k.purchasable) return this.toasts.show('info', 'Los pagos se activan pronto');
    this.busyPack.set(k.id);
    try {
      await this.api.buyPack(k.id); // Stripe Checkout (en la demo, pago simulado)
      if (billing === 'simulated') this.toasts.show('success', `Has sumado ${k.credits + k.bonusCredits} créditos que no caducan`, { label: 'Crear', link: '/crear' });
    } catch (e) {
      this.toasts.show('error', e instanceof ApiError ? e.message : 'No se ha podido abrir el pago');
    } finally {
      this.busyPack.set(null);
    }
  }

  protected readonly lidOf = lidOf;

  protected monthly(p: PlanLimits): number {
    return this.interval() === 'year' ? Math.round(p.priceYearCents / 12) : p.priceMonthCents;
  }

  protected async choose(p: PlanLimits): Promise<void> {
    if (!(await this.gates.ensureSignedIn())) return;
    this.error.set('');
    const { billing } = await this.api.capabilities();
    if (billing === 'simulated') return this.buying.set(p); // demo: confirmación sin cobro
    if (billing === 'off') return this.toasts.show('info', 'Los pagos se activan pronto');
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
