import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Icon } from '../ui/icon';
import { Handoff } from '../features/workspace/handoff';
import { PaintingViewer, type PaintStep } from '../features/showcase/painting-viewer';
import { Api, Asset, Catalog, Series } from '../data/api';
import { Gates } from '../shell/gates';
import { type Lid } from '../data/lids';

/** Modelos de ejemplo reales, generados con My3DStudio (public/showcase/provenance.json). */
const SHOWCASE = [
  { slug: 'dragon', name: 'Dragón de miniatura', prompt: 'Un dragón pequeño posado sobre una roca, figura de miniatura para juego de rol de mesa' },
  { slug: 'caballo', name: 'Caballo de ajedrez', prompt: 'La pieza de ajedrez del caballo con armadura medieval, sobre peana redonda' },
  { slug: 'estacion', name: 'Estación de maqueta', prompt: 'Una pequeña estación de tren rural de piedra y madera para maqueta de tren de jardín' },
  { slug: 'buho', name: 'Búho de cerámica', prompt: 'Un búho decorativo de cerámica sentado, con plumas talladas' },
  { slug: 'maceta', name: 'Maceta facetada', prompt: 'Una maceta geométrica facetada con una suculenta dentro' },
] as const;


/**
 * S01 portada de la tienda: «La guía de pintado». Un modelo real gira sobre su peana, en gris como saldrá impreso.
 * El primer bote es la zona de subida; los demás enseñan la figura, la referencia y las medidas.
 */
@Component({
  selector: 'app-home',
  imports: [Icon, RouterLink, PaintingViewer, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Primera vista: el modelo y la guía de cuatro botes, sobre gris imprimación -->
    <section aria-labelledby="hero-title" class="ground-primer -mt-[3.75rem] pt-[3.75rem]">
      <div class="max-w-[80rem] mx-auto px-4 sm:px-8 pt-6 sm:pt-10 pb-12 grid grid-cols-[minmax(0,1fr)] lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:content-start gap-x-8 gap-y-6">
        <div class="lg:col-span-5 lg:row-start-1 flex flex-col gap-4 lg:pt-4">
          <h1 id="hero-title" class="font-display uppercase text-[3.25rem] sm:text-[4.75rem] leading-[0.88]">De una foto a tu figura impresa</h1>
          <p class="text-sm sm:text-base max-w-[36ch]">Creamos el modelo 3D gratis, lo giras y lo revisas, y te imprimimos la figura en el tamaño y color que elijas.
            @if (from(); as f) { <span class="figures font-semibold">Desde {{ f / 100 | currency: 'EUR' : 'symbol' : '1.2-2' : 'es' }}, envío aparte.</span> }</p>
        </div>

        <!-- El modelo, girando sobre su peana (en móvil, justo bajo el titular) -->
        <div class="min-w-0 lg:col-start-6 lg:col-span-7 lg:row-start-1 lg:row-span-2 flex flex-col gap-3">
          <!-- three.js (525 KB) y el modelo (250-510 KB con meshopt) no compiten con el titular (LCP): se cargan cuando la página está libre.
               El hueco tiene la misma altura que el visor para que no haya saltos. -->
          @defer (on idle) {
            <app-painting-viewer class="h-[16.5rem] sm:h-[30rem] lg:h-[min(68svh,38rem)]"
              [url]="'/showcase/' + example().slug + '.glb'" [name]="example().name" [source]="example().prompt" [step]="step()" />
          } @placeholder {
            <div class="h-[16.5rem] sm:h-[30rem] lg:h-[min(68svh,38rem)] grid place-items-center" aria-hidden="true">
              <span class="w-40 h-40 rounded-full bg-primer-deep/60"></span>
            </div>
          } @error {
            <!-- si el código del visor no llega a descargarse, se avisa en vez de dejar el hueco vacío -->
            <div class="h-[16.5rem] sm:h-[30rem] lg:h-[min(68svh,38rem)] grid place-content-center justify-items-center gap-3 text-sm text-ink text-center">
              <p>No se ha podido cargar el visor 3D.</p>
              <button type="button" class="btn bg-ink text-bone hover:bg-ink-soft" (click)="reload()">Recargar la página</button>
            </div>
          }
          <!-- Radios nativos: una sola parada de tabulador y flechas para cambiar de ejemplo (antes, cinco paradas) -->
          <fieldset class="min-w-0">
            <legend class="text-xs font-semibold mb-2">Modelos reales, hechos con My3DStudio a partir de una frase:</legend>
            <div class="flex sm:flex-wrap gap-2 overflow-x-auto sm:overflow-visible -mx-4 px-4 sm:mx-0 sm:px-0 py-1">
              @for (e of examples; track e.slug) {
                <label class="focus-ring-within relative h-8 px-3 shrink-0 inline-flex items-center cursor-pointer rounded-pill border-2 border-ink text-xs font-semibold hover:bg-ink/10 has-[:checked]:bg-ink has-[:checked]:text-bone">
                  <input type="radio" name="showcase-example" class="sr-only" [value]="e.slug" [checked]="example().slug === e.slug" (change)="example.set(e)" />
                  {{ e.name }}
                </label>
              }
            </div>
          </fieldset>
        </div>

        <div class="lg:col-span-5 lg:row-start-2 flex flex-col gap-6">
          <!-- Bote 1: la zona de subida de verdad -->
          <div class="flex items-start gap-4">
            <input #file type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" tabindex="-1" aria-hidden="true"
              (change)="picked($event)" />
            <button type="button" (click)="file.click()" (dragover)="over($event)" (dragleave)="dragging.set(false)" (drop)="drop($event)"
              [attr.aria-describedby]="error() ? 'drop-error' : 'drop-hint'"
              [attr.aria-label]="preview() ? 'Cambiar la foto' : 'Elegir una foto: arrástrala, pégala o haz clic'"
              class="shrink-0 rounded-full focus-visible:outline-offset-4">
              <span class="pot-lid lid-enter w-28 h-28 sm:w-40 sm:h-40 rounded-full grid place-items-center overflow-hidden"
                style="--i: 0" [class.scale-105]="dragging()">
                @if (preview(); as src) {
                  <img [src]="src" alt="Imagen de referencia subida" class="w-[78%] h-[78%] rounded-full object-cover ring-4 ring-bone" />
                } @else {
                  <span class="flex flex-col items-center gap-1 text-center px-4">
                    <span class="font-display text-[2.25rem] font-extrabold leading-none">1</span>
                    <ui-icon name="upload" [size]="22" />
                    <span class="text-xs font-semibold leading-tight">{{ dragging() ? 'Suéltala' : 'Tu foto aquí' }}</span>
                  </span>
                }
              </span>
            </button>
            <div class="flex flex-col gap-3 pt-2 min-w-0">
              <p class="font-display text-[1.5rem] font-extrabold uppercase leading-none">Foto</p>
              <p id="drop-hint" class="text-xs max-w-[28ch]">Arrástrala, pégala o haz clic. JPG, PNG o WEBP, hasta 20 MB.</p>
              @if (error()) { <p id="drop-error" class="text-xs font-semibold text-lid-red bg-bone px-2 py-1 self-start" role="alert">{{ error() }}</p> }
              <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
                <button type="button" class="btn btn-primary btn-lg" (click)="go()">Crear mi figura · gratis</button>
                <a routerLink="/crear" [queryParams]="{ serie: series() }" class="text-sm font-semibold underline inline-block py-[3px] -my-[3px]">o descríbelo con palabras</a>
              </div>
            </div>
          </div>

          <!-- Botes 2 a 4: repintan el modelo de la derecha -->
          <div role="group" aria-label="Ver el modelo en cada paso" class="grid grid-cols-3 gap-4 max-w-[26rem] pt-2">
            @for (p of pots; track p.step; let i = $index) {
              <button type="button" [attr.aria-pressed]="step() === p.step" (click)="choose(p.step)"
                class="group flex flex-col items-center gap-2 rounded-lg p-1">
                <span class="pot-lid lid-enter w-20 h-20 rounded-full grid place-items-center" [style.--i]="i + 1" [attr.data-lid]="p.lid"
                 >
                  <span class="font-display text-[1.875rem] font-extrabold leading-none">{{ p.n }}</span>
                </span>
                <span class="font-display text-lg font-extrabold uppercase leading-none">{{ p.label }}</span>
              </button>
            }
          </div>
        </div>
      </div>
    </section>

    @if (gates.me() && recent().length) {
      <section aria-labelledby="recent-title" class="ground-ink">
        <div class="max-w-[80rem] mx-auto px-4 sm:px-8 py-10">
          <div class="flex items-end justify-between mb-4 border-b-2 border-bone/30 pb-2">
            <h2 id="recent-title" class="text-[1.875rem] uppercase">Tus últimos modelos</h2>
            <a routerLink="/mis-modelos" class="text-sm underline">Ver todos</a>
          </div>
          <ul class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            @for (a of recent(); track a.id) {
              <li><a [routerLink]="['/crear']" [queryParams]="{ modelo: a.id }" class="block group">
                @if (a.thumbnailUrl) { <img [src]="a.thumbnailUrl" [alt]="a.name" class="aspect-square w-full object-cover rounded-full bg-primer group-hover:ring-4 ring-lid-mustard" /> }
                @else { <span class="block aspect-square rounded-full bg-primer group-hover:ring-4 ring-lid-mustard"></span> }
                <span class="block pt-2 text-xs text-center truncate">{{ a.name }}</span></a></li>
            }
          </ul>
        </div>
      </section>
    }

    <!-- La guía, como la página de un manual de pintado -->
    <section aria-labelledby="guia" class="ground-bone">
      <div class="max-w-[80rem] mx-auto px-4 sm:px-8 py-16 sm:py-24 grid lg:grid-cols-12 gap-8">
        <div class="lg:col-span-4">
          <h2 id="guia" class="text-[3rem] sm:text-[3.75rem] uppercase leading-[0.9] lg:sticky lg:top-24">De tu foto a tu estantería</h2>
        </div>
        <ol class="lg:col-span-8 flex flex-col">
          @for (s of guide; track s.title; let i = $index) {
            <li class="grid grid-cols-[4rem_1fr] sm:grid-cols-[5rem_1fr_14rem] gap-x-6 gap-y-2 py-6 border-t-2 keyline">
              <span class="pot-lid w-14 h-14 sm:w-16 sm:h-16 rounded-full grid place-items-center row-span-2" [attr.data-lid]="s.lid" aria-hidden="true">
                <span class="font-display text-[1.5rem] font-extrabold">{{ i + 1 }}</span>
              </span>
              <h3 class="font-display text-[1.875rem] font-extrabold uppercase leading-none self-end">{{ s.title }}</h3>
              <p class="text-sm leading-relaxed max-w-[52ch] sm:col-start-2">{{ s.text }}</p>
              <p class="col-start-2 sm:col-start-3 sm:row-start-1 sm:row-span-2 text-xs border-l-2 keyline pl-3 self-start figures">
                <span class="block font-semibold">Obtienes</span>{{ s.gets }}</p>
            </li>
          }
        </ol>
      </div>
    </section>

    <!-- Lo que nunca se cobra aparte: la etiqueta del bote -->
    <section aria-labelledby="promesas" class="ground-ink">
      <div class="max-w-[80rem] mx-auto px-4 sm:px-8 py-16 sm:py-24 grid lg:grid-cols-12 gap-8">
        <div class="lg:col-span-5 flex flex-col gap-4">
          <h2 id="promesas" class="text-[3rem] sm:text-[3.75rem] uppercase leading-[0.9]">Sin letra pequeña en la etiqueta</h2>
          <p class="text-sm text-bone/85 max-w-[40ch]">No necesitas impresora, ni saber de 3D, ni suscribirte a nada. Creas el modelo,
            lo miras por todos lados y solo pagas si quieres la figura.</p>
        </div>
        <div class="lg:col-span-7 ground-bone px-5 sm:px-8 py-4 shadow-[0_12px_32px_rgb(0_0_0/0.35)]">
          <div class="flex items-baseline justify-between border-b-2 keyline pb-2 mb-1">
            <span class="font-display text-[1.5rem] font-extrabold uppercase leading-none">Contenido del bote</span>
            <span class="text-xs figures">{{ promises.length }} garantías</span>
          </div>
          <dl>
          @for (f of promises; track f.title) {
            <div class="grid sm:grid-cols-[13rem_1fr] gap-x-6 gap-y-1 py-3 border-t keyline first-of-type:border-t-0">
              <dt class="font-display text-[1.375rem] font-extrabold uppercase leading-none">{{ f.title }}</dt>
              <dd class="text-sm">{{ f.text }}</dd>
            </div>
          }
          </dl>
        </div>
      </div>
    </section>

    <!-- Precios: cada bote lleva su precio en la tapa -->
    <section aria-labelledby="precio" class="ground-primer">
      <div class="max-w-[80rem] mx-auto px-4 sm:px-8 py-16 sm:py-24 flex flex-col gap-10">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <h2 id="precio" class="text-[3rem] sm:text-[3.75rem] uppercase leading-[0.9] max-w-[16ch]">El precio, en la tapa</h2>
          <p class="text-sm max-w-[44ch]">Crear y revisar el modelo es gratis. Pagas la figura, con IVA, y el envío a casa
            @if (cat(); as c) { (<span class="figures">{{ c.shippingCents / 100 | currency: 'EUR' : 'symbol' : '1.2-2' : 'es' }}</span>) }.
            Nada de suscripciones ni créditos.</p>
        </div>
        @if (cat(); as c) {
          <ul class="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-10">
            @for (z of c.sizes; track z.id; let i = $index) {
              <li class="flex flex-col items-center text-center gap-3">
                <span class="pot-lid w-32 h-32 sm:w-36 sm:h-36 rounded-full grid place-items-center" [attr.data-lid]="lids[i % lids.length]">
                  <span class="flex flex-col items-center leading-none figures">
                    <span class="font-display text-[2.25rem] font-extrabold">{{ z.priceCents / 100 | currency: 'EUR' : 'symbol' : '1.2-2' : 'es' }}</span>
                    <span class="text-xs font-semibold pt-1">{{ z.heightMm / 10 }} cm</span>
                  </span>
                </span>
                <span class="font-display text-[1.5rem] font-extrabold uppercase leading-none">{{ z.name }}</span>
                <span class="text-sm figures">{{ z.heightMm }} mm de alto · {{ c.colors.length }} colores</span>
              </li>
            }
          </ul>
        }
        <a routerLink="/crear" class="btn btn-lg bg-ink text-bone hover:bg-ink-soft self-start">Crear mi figura <ui-icon name="arrow-right" /></a>
      </div>
    </section>

    <!-- Preguntas -->
    <section aria-labelledby="faq" class="ground-bone">
      <div class="max-w-[80rem] mx-auto px-4 sm:px-8 py-16 sm:py-24 grid lg:grid-cols-12 gap-8">
        <h2 id="faq" class="lg:col-span-4 text-[3rem] sm:text-[3.75rem] uppercase leading-[0.9]">Preguntas de taller</h2>
        <div class="lg:col-span-8 flex flex-col">
          @for (q of faq; track q.q) {
            <details class="group border-t-2 keyline py-4">
              <summary class="cursor-pointer list-none flex items-center justify-between gap-4 font-display text-[1.5rem] font-extrabold uppercase leading-tight">
                {{ q.q }}<ui-icon name="chevron-down" class="shrink-0 transition-transform duration-base group-open:rotate-180" />
              </summary>
              <p class="text-sm leading-relaxed max-w-[60ch] pt-3">{{ q.a }}</p>
            </details>
          }
        </div>
      </div>
    </section>

    <!-- Cierre -->
    <section aria-labelledby="cierre" class="ground-ink">
      <div class="max-w-[80rem] mx-auto px-4 sm:px-8 py-16 sm:py-24 flex flex-col sm:flex-row sm:items-center justify-between gap-8">
        <div class="flex items-center gap-6">
          <span class="pot-lid w-24 h-24 rounded-full grid place-items-center shrink-0" aria-hidden="true">
            <span class="font-display text-[2.25rem] font-extrabold">1</span>
          </span>
          <div>
            <h2 id="cierre" class="text-[3rem] sm:text-[3.75rem] uppercase leading-[0.9]">Empieza por la foto</h2>
            <p class="text-sm text-bone/85 pt-2">Crear el modelo es gratis. Solo pagas la figura, si te convence.</p>
          </div>
        </div>
        <a routerLink="/crear" class="btn btn-primary btn-lg self-start sm:self-auto">Crear mi figura <ui-icon name="arrow-right" /></a>
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
  // la figura se imprime de un color: el modelo se enseña en gris imprimación, como saldrá
  protected readonly step = signal<PaintStep>('malla');
  protected readonly examples = SHOWCASE;
  protected readonly example = signal<(typeof SHOWCASE)[number]>(SHOWCASE[0]);
  private file: File | null = null;
  private readonly assets = toSignal(this.api.assets(), { initialValue: [] as Asset[] });
  protected recent = () => this.assets().slice(0, 6);

  protected readonly pots: { step: PaintStep; n: number; label: string; lid: Lid }[] = [
    { step: 'malla', n: 2, label: 'Figura', lid: 'mustard' },
    { step: 'textura', n: 3, label: 'Referencia', lid: 'blue' },
    { step: 'archivo', n: 4, label: 'Medidas', lid: 'green' },
  ];
  protected readonly guide: { title: string; text: string; gets: string; lid: Lid }[] = [
    { title: 'Foto o frase', lid: 'red', gets: 'Gratis, sin tarjeta',
      text: 'Sube una foto con el objeto centrado y el fondo limpio, o descríbelo con una frase. Si lo describes, primero ves la imagen de la que saldrá.' },
    { title: 'Modelo 3D', lid: 'mustard', gets: 'Listo en unos minutos',
      text: 'Creamos el modelo en 3D. Gíralo en el visor y míralo por todos lados. Si no te convence, crea otro.' },
    { title: 'Tamaño y color', lid: 'blue', gets: 'Tres tamaños, varios colores y peana opcional',
      text: 'Elige la altura, el color del material y si la quieres con peana. Ves el precio total, con envío, antes de pagar.' },
    { title: 'A tu casa', lid: 'green', gets: 'Seguimiento del pedido en tu cuenta',
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
    { q: '¿Cuánto cuesta?', a: 'Crear el modelo es gratis. La figura cuesta según el tamaño (lo ves en la tapa) más el envío. El total sale antes de pagar.' },
    { q: '¿De qué material es?', a: 'De plástico de impresión 3D, en un solo color que eliges tú. No va pintada: si quieres pintarla, el gris imprimación es el más cómodo.' },
    { q: '¿Cuántos modelos puedo crear gratis?', a: 'Unos cuantos al día por persona. Cada modelo usa GPU de pago, así que hay un tope diario; al día siguiente puedes crear más.' },
    { q: '¿Cuánto tarda en llegar?', a: 'Normalmente entre 5 y 8 días laborables desde el pago: la imprimimos, la revisamos y la enviamos. Por ahora solo enviamos a España.' },
    { q: '¿Puedo descargar el archivo 3D?', a: 'No: vendemos la figura impresa, no el archivo. Así no tienes que preocuparte de laminadores ni de mallas.' },
    { q: '¿Y si el modelo no sale bien?', a: 'Antes de pagar lo ves en 3D desde todos los lados. Si no te convence, crea otro; solo pides la figura cuando te guste.' },
  ];
  /** Una tapa por tamaño, en el orden de las tapas de la guía. */
  protected readonly lids: Lid[] = ['red', 'mustard', 'blue'];
  protected readonly cat = signal<Catalog | null>(null);
  protected readonly from = computed(() => this.cat()?.sizes.reduce((m, z) => Math.min(m, z.priceCents), Infinity) ?? null);

  constructor() {
    void this.api.catalog().then((c) => this.cat.set(c)).catch(() => {});
  }

  protected choose(s: PaintStep): void {
    this.step.set(this.step() === s ? 'malla' : s);
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
