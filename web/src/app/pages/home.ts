import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Icon } from '../ui/icon';
import { Handoff } from '../features/workspace/handoff';
import { PaintingViewer, type PaintStep } from '../features/showcase/painting-viewer';
import { Api, Asset, Catalog, Series } from '../data/api';
import { Gates } from '../shell/gates';
import { SHOWCASE, type ShowcaseModel } from '../data/showcase';


/**
 * S01 portada de la tienda. Un modelo real gira sobre su peana.
 * El modelo se enseña con su textura; los pasos numerados solo explican el proceso.
 */
@Component({
  selector: 'app-home',
  imports: [Icon, RouterLink, PaintingViewer, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Primera vista: titular en serif, la subida de la foto y el modelo flotando sobre el fondo, sin marco -->
    <section aria-labelledby="hero-title">
      <div class="max-w-[80rem] mx-auto px-4 sm:px-8 pt-6 sm:pt-12 pb-16 sm:pb-24 grid grid-cols-[minmax(0,1fr)] lg:grid-cols-12 lg:grid-rows-[auto_1fr] gap-x-10 gap-y-8">
        <div class="lg:col-span-5 lg:row-start-1 flex flex-col gap-5 lg:pt-6">
          <h1 id="hero-title" class="text-[2.75rem] sm:text-[4.25rem] leading-[1.02]">De una foto a tu figura impresa</h1>
          <p class="text-base sm:text-lg sm:font-normal text-text-muted max-w-[38ch]">Creamos el modelo 3D gratis, lo giras y lo revisas, y te imprimimos la figura en el tamaño y color que elijas.
            @if (from(); as f) { <span class="figures text-text font-medium">Desde {{ f / 100 | currency: 'EUR' : 'symbol' : '1.2-2' : 'es' }}, envío aparte.</span> }</p>
        </div>

        <!-- El modelo, girando sobre su peana (en móvil, justo bajo el titular) -->
        <div class="min-w-0 lg:col-start-6 lg:col-span-7 lg:row-start-1 lg:row-span-2 flex flex-col gap-4">
          <!-- three.js (525 KB) y el modelo (250-510 KB con meshopt) no compiten con el titular (LCP): se cargan cuando la página está libre.
               El hueco tiene la misma altura que el visor para que no haya saltos. -->
          @defer (on idle) {
            <app-painting-viewer class="h-[16.5rem] sm:h-[30rem] lg:h-[min(64svh,36rem)]"
              [url]="'/showcase/' + example().slug + '.glb'" [name]="example().name" [source]="example().prompt" [step]="step" />
          } @placeholder {
            <div class="h-[16.5rem] sm:h-[30rem] lg:h-[min(64svh,36rem)] grid place-items-center" aria-hidden="true">
              <span class="w-40 h-40 rounded-full bg-surface-3/70"></span>
            </div>
          } @error {
            <!-- si el código del visor no llega a descargarse, se avisa en vez de dejar el hueco vacío -->
            <div class="h-[16.5rem] sm:h-[30rem] lg:h-[min(64svh,36rem)] grid place-content-center justify-items-center gap-3 text-sm text-center">
              <p>No se ha podido cargar el visor 3D.</p>
              <button type="button" class="btn btn-primary" (click)="reload()">Recargar la página</button>
            </div>
          }
          <!-- Radios nativos: una sola parada de tabulador y flechas para cambiar de ejemplo -->
          <fieldset class="min-w-0">
            <legend class="text-xs text-text-muted mb-2">Modelos reales, hechos con My3DStudio a partir de una frase:</legend>
            <div class="flex sm:flex-wrap gap-2 overflow-x-auto sm:overflow-visible -mx-4 px-4 sm:mx-0 sm:px-0 py-1">
              @for (e of examples; track e.slug) {
                <label class="focus-ring-within relative h-8 px-3 shrink-0 inline-flex items-center cursor-pointer rounded-pill border border-border-input text-xs font-medium text-text-muted transition-colors duration-fast hover:text-text hover:border-text has-[:checked]:bg-text has-[:checked]:border-text has-[:checked]:text-bg">
                  <input type="radio" name="showcase-example" class="sr-only" [value]="e.slug" [checked]="example().slug === e.slug" (change)="example.set(e)" />
                  {{ e.name }}
                </label>
              }
            </div>
          </fieldset>
        </div>

        <div class="lg:col-span-5 lg:row-start-2 flex flex-col gap-6">
          <!-- La zona de subida de verdad: arrastrar, pegar o hacer clic -->
          <input #file type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" tabindex="-1" aria-hidden="true"
            (change)="picked($event)" />
          <button type="button" (click)="file.click()" (dragover)="over($event)" (dragleave)="dragging.set(false)" (drop)="drop($event)"
            [attr.aria-describedby]="error() ? 'drop-error' : 'drop-hint'"
            [attr.aria-label]="preview() ? 'Cambiar la foto' : 'Elegir una foto: arrástrala, pégala o haz clic'"
            class="flex items-center gap-4 p-4 rounded-xl border-2 border-dashed text-left bg-surface transition-colors duration-fast hover:border-accent"
            [class.border-accent]="dragging()" [class.bg-highlight-surface]="dragging()" [class.border-border-input]="!dragging()">
            @if (preview(); as src) {
              <img [src]="src" alt="Imagen de referencia subida" class="w-16 h-16 rounded-lg object-cover shrink-0" />
            } @else {
              <span class="w-16 h-16 rounded-lg bg-highlight-surface text-accent grid place-items-center shrink-0"><ui-icon name="upload" [size]="24" /></span>
            }
            <span class="flex flex-col gap-1 min-w-0">
              <span class="text-base font-semibold">{{ dragging() ? 'Suéltala aquí' : preview() ? 'Foto lista · cambiar' : 'Sube tu foto' }}</span>
              <span id="drop-hint" class="text-xs text-text-muted">Arrástrala, pégala o haz clic. JPG, PNG o WEBP, hasta 20 MB.</span>
            </span>
          </button>
          @if (error()) { <p id="drop-error" class="text-sm font-medium text-danger -mt-3" role="alert">{{ error() }}</p> }
          <div class="flex flex-wrap items-center gap-x-5 gap-y-3">
            <button type="button" class="btn btn-primary btn-lg" (click)="go()">Crear mi figura · gratis</button>
            <a routerLink="/crear" [queryParams]="{ serie: series() }" class="text-sm font-medium underline inline-block py-[3px] -my-[3px]">o descríbelo con palabras</a>
          </div>

          <!-- Los pasos, solo informativos -->
          <ol aria-label="Pasos" class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-medium text-text-muted pt-2">
            @for (p of steps; track p.n; let first = $first) {
              <li class="flex items-center gap-3">
                @if (!first) { <ui-icon name="arrow-right" [size]="14" aria-hidden="true" /> }
                <span class="flex items-center gap-2"><span class="step-num">{{ p.n }}</span> {{ p.label }}</span>
              </li>
            }
          </ol>
        </div>
      </div>
    </section>

    @if (gates.me() && recent().length) {
      <section aria-labelledby="recent-title" class="bg-surface-2">
        <div class="max-w-[80rem] mx-auto px-4 sm:px-8 py-12">
          <div class="flex items-end justify-between mb-6">
            <h2 id="recent-title" class="section-heading text-[1.75rem]">Tus últimos modelos</h2>
            <a routerLink="/mis-modelos" class="text-sm underline">Ver todos</a>
          </div>
          <ul class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            @for (a of recent(); track a.id) {
              <li><a [routerLink]="['/crear']" [queryParams]="{ modelo: a.id }" class="block group">
                @if (a.thumbnailUrl) { <img [src]="a.thumbnailUrl" [alt]="a.name" class="aspect-square w-full object-cover rounded-lg bg-surface ring-accent group-hover:ring-2" /> }
                @else { <span class="block aspect-square rounded-lg bg-surface ring-accent group-hover:ring-2"></span> }
                <span class="block pt-2 text-xs text-center truncate">{{ a.name }}</span></a></li>
            }
          </ul>
        </div>
      </section>
    }

    <!-- Cómo funciona -->
    <section aria-labelledby="guia" class="border-t border-border">
      <div class="max-w-[80rem] mx-auto px-4 sm:px-8 py-16 sm:py-24 grid lg:grid-cols-12 gap-10">
        <div class="lg:col-span-4">
          <h2 id="guia" class="section-heading lg:sticky lg:top-24">De tu foto a tu estantería</h2>
        </div>
        <ol class="lg:col-span-8 flex flex-col">
          @for (s of guide; track s.title; let i = $index) {
            <li class="grid grid-cols-[3rem_1fr] sm:grid-cols-[4rem_1fr_13rem] gap-x-6 gap-y-2 py-7 border-t border-border first:border-t-0 first:pt-0">
              <span class="font-display text-[2.5rem] leading-none text-accent row-span-2 figures" aria-hidden="true">{{ i + 1 }}</span>
              <h3 class="text-[1.25rem] leading-tight font-semibold self-end">{{ s.title }}</h3>
              <p class="text-sm text-text-muted leading-relaxed max-w-[52ch] sm:col-start-2">{{ s.text }}</p>
              <p class="col-start-2 sm:col-start-3 sm:row-start-1 sm:row-span-2 text-xs self-start figures text-text-muted">
                <span class="block font-semibold text-text">Obtienes</span>{{ s.gets }}</p>
            </li>
          }
        </ol>
      </div>
    </section>

    <!-- Lo que nunca se cobra aparte -->
    <section aria-labelledby="promesas" class="bg-surface-2">
      <div class="max-w-[80rem] mx-auto px-4 sm:px-8 py-16 sm:py-24 flex flex-col gap-10">
        <div class="flex flex-col gap-4 max-w-[46ch]">
          <h2 id="promesas" class="section-heading">Sin letra pequeña</h2>
          <p class="text-base text-text-muted">No necesitas impresora, ni saber de 3D, ni suscribirte a nada. Creas el modelo,
            lo miras por todos lados y solo pagas si quieres la figura.</p>
        </div>
        <dl class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          @for (f of promises; track f.title) {
            <div class="flex flex-col gap-2 p-6 rounded-xl bg-surface border border-border">
              <dt class="text-base font-semibold">{{ f.title }}</dt>
              <dd class="text-sm text-text-muted leading-relaxed">{{ f.text }}</dd>
            </div>
          }
        </dl>
      </div>
    </section>

    <!-- Precios -->
    <section aria-labelledby="precio">
      <div class="max-w-[80rem] mx-auto px-4 sm:px-8 py-16 sm:py-24 flex flex-col gap-10">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <h2 id="precio" tabindex="-1" class="section-heading scroll-mt-24 focus:outline-none">Precios</h2>
          <p class="text-sm text-text-muted max-w-[44ch]">Crear y revisar el modelo es gratis. Pagas la figura, con IVA, y el envío a casa
            @if (cat(); as c) { (<span class="figures">{{ c.shippingCents / 100 | currency: 'EUR' : 'symbol' : '1.2-2' : 'es' }}</span>) }.
            Nada de suscripciones ni créditos.</p>
        </div>
        @if (cat(); as c) {
          <ul class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            @for (z of c.sizes; track z.id) {
              <li class="flex flex-col gap-4 p-6 sm:p-8 rounded-xl bg-surface border border-border">
                <span class="text-sm font-semibold">{{ z.name }}</span>
                <span class="font-display text-[3rem] leading-none figures">{{ z.priceCents / 100 | currency: 'EUR' : 'symbol' : '1.2-2' : 'es' }}</span>
                <span class="text-sm text-text-muted figures">{{ z.heightMm / 10 }} cm de alto · {{ c.colors.length }} colores</span>
              </li>
            }
          </ul>
        }
        <a routerLink="/crear" class="btn btn-primary btn-lg self-start">Crear mi figura <ui-icon name="arrow-right" /></a>
      </div>
    </section>

    <!-- Preguntas -->
    <section aria-labelledby="faq" class="border-t border-border">
      <div class="max-w-[80rem] mx-auto px-4 sm:px-8 py-16 sm:py-24 grid lg:grid-cols-12 gap-10">
        <h2 id="faq" class="section-heading lg:col-span-4">Preguntas frecuentes</h2>
        <div class="lg:col-span-8 flex flex-col">
          @for (q of faq; track q.q) {
            <details class="group border-b border-border py-5">
              <summary class="cursor-pointer list-none flex items-center justify-between gap-4 text-lg font-medium">
                {{ q.q }}<ui-icon name="chevron-down" class="shrink-0 text-text-muted transition-transform duration-base group-open:rotate-180" />
              </summary>
              <p class="text-sm text-text-muted leading-relaxed max-w-[60ch] pt-3">{{ q.a }}</p>
            </details>
          }
        </div>
      </div>
    </section>

    <!-- Cierre -->
    <section aria-labelledby="cierre" class="max-w-[80rem] mx-auto px-4 sm:px-8 pb-16 sm:pb-24">
      <div class="rounded-xl bg-accent text-on-accent px-6 sm:px-12 py-12 sm:py-16 flex flex-col sm:flex-row sm:items-center justify-between gap-8">
        <div class="flex flex-col gap-2">
          <h2 id="cierre" class="section-heading">Empieza por la foto</h2>
          <p class="text-base opacity-90">Crear el modelo es gratis. Solo pagas la figura, si te convence.</p>
        </div>
        <a routerLink="/crear" class="btn btn-lg bg-on-accent text-accent hover:bg-surface-2 self-start sm:self-auto">Crear mi figura <ui-icon name="arrow-right" /></a>
      </div>
    </section>
  `,
})
export class Home {
  private readonly router = inject(Router);
  private readonly handoff = inject(Handoff);
  private readonly api = inject(Api);
  protected readonly gates = inject(Gates);
  protected readonly series = signal<Series>('hd');
  protected readonly preview = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly dragging = signal(false);
  // el modelo se enseña con su textura (modo «Referencia»)
  protected readonly step: PaintStep = 'textura';
  protected readonly examples = SHOWCASE;
  protected readonly example = signal<ShowcaseModel>(SHOWCASE[0]);
  private file: File | null = null;
  private readonly assets = toSignal(this.api.assets(), { initialValue: [] as Asset[] });
  protected recent = () => this.assets().slice(0, 6);

  protected readonly steps = [
    { n: 1, label: 'Foto' }, { n: 2, label: 'Figura' }, { n: 3, label: 'Referencia' }, { n: 4, label: 'Medidas' },
  ];
  protected readonly guide: { title: string; text: string; gets: string }[] = [
    { title: 'Foto o frase', gets: 'Gratis, sin tarjeta',
      text: 'Sube una foto con el objeto centrado y el fondo limpio, o descríbelo con una frase. Si lo describes, primero ves la imagen de la que saldrá.' },
    { title: 'Modelo 3D', gets: 'Listo en unos minutos',
      text: 'Creamos el modelo en 3D. Gíralo en el visor y míralo por todos lados. Si no te convence, crea otro.' },
    { title: 'Tamaño y color', gets: 'Tres tamaños, varios colores y peana opcional',
      text: 'Elige la altura, el color del material y si la quieres con peana. Ves el precio total, con envío, antes de pagar.' },
    { title: 'A tu casa', gets: 'Seguimiento del pedido en tu cuenta',
      text: 'La imprimimos en nuestro taller y te la enviamos. En Mis pedidos ves si está en cola, imprimiéndose o enviada.' },
  ];
  protected readonly promises = [
    { title: 'Gratis hasta que la pides', text: 'Crear y revisar el modelo no cuesta nada. Solo pagas la figura que quieras recibir.' },
    { title: 'Ves antes de pagar', text: 'Con una frase, primero ves la imagen de la que saldrá el modelo. Y el modelo lo giras en 3D antes de pedirlo.' },
    { title: 'Precio cerrado', text: 'Tamaño, color, peana y envío: el total aparece antes de pagar, con IVA. Sin suscripciones ni créditos.' },
    { title: 'Sin impresora', text: 'No necesitas saber de 3D ni tener impresora. Nosotros preparamos el archivo y la imprimimos.' },
    { title: 'Tus modelos, privados', text: 'Lo que creas solo lo ves tú. No se publica en ninguna galería.' },
    { title: 'Sabes dónde está', text: 'Cada pedido muestra su estado y, cuando sale, el número de seguimiento del envío.' },
  ];
  protected readonly faq = [
    { q: '¿Cuánto cuesta?', a: 'Crear el modelo es gratis. La figura cuesta según el tamaño (lo ves en Precios) más el envío. El total sale antes de pagar.' },
    { q: '¿De qué material es?', a: 'De plástico de impresión 3D, en un solo color que eliges tú. No va pintada: si quieres pintarla, el gris imprimación es el más cómodo.' },
    { q: '¿Cuántos modelos puedo crear gratis?', a: 'Unos cuantos al día por persona. Cada modelo usa GPU de pago, así que hay un tope diario; al día siguiente puedes crear más.' },
    { q: '¿Cuánto tarda en llegar?', a: 'Normalmente entre 5 y 8 días laborables desde el pago: la imprimimos, la revisamos y la enviamos. Por ahora solo enviamos a España.' },
    { q: '¿Puedo descargar el archivo 3D?', a: 'No: vendemos la figura impresa, no el archivo. Así no tienes que preocuparte de laminadores ni de mallas.' },
    { q: '¿Y si el modelo no sale bien?', a: 'Antes de pagar lo ves en 3D desde todos los lados. Si no te convence, crea otro; solo pides la figura cuando te guste.' },
  ];
  protected readonly cat = signal<Catalog | null>(null);
  protected readonly from = computed(() => this.cat()?.sizes.reduce((m, z) => Math.min(m, z.priceCents), Infinity) ?? null);

  constructor() {
    void this.api.catalog().then((c) => this.cat.set(c)).catch(() => {});
  }

  protected reload(): void {
    location.reload();
  }

  protected over(e: DragEvent): void {
    e.preventDefault();
    this.dragging.set(true);
  }

  protected drop(e: DragEvent): void {
    e.preventDefault();
    this.dragging.set(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) this.pick(f);
  }

  protected picked(e: Event): void {
    const el = e.target as HTMLInputElement;
    const f = el.files?.[0];
    if (f) this.pick(f);
    el.value = '';
  }

  @HostListener('document:paste', ['$event'])
  protected paste(e: ClipboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
    const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith('image/'));
    if (f) this.pick(f);
  }

  protected pick(f: File): void {
    this.error.set('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
      this.error.set('Formato no admitido. Usa JPG, PNG o WEBP');
      return;
    }
    if (this.preview()) URL.revokeObjectURL(this.preview()!);
    this.file = f;
    this.preview.set(URL.createObjectURL(f));
  }

  protected go(): void {
    if (!this.file) {
      this.error.set('Elige primero una foto');
      return;
    }
    this.handoff.pending = { file: this.file, series: this.series() };
    void this.router.navigate(['/crear'], { queryParams: { serie: this.series() } });
  }
}
