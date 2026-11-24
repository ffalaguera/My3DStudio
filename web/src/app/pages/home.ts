import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Icon } from '../ui/icon';
import { Handoff } from '../features/workspace/handoff';
import { PaintingViewer, type PaintStep } from '../features/showcase/painting-viewer';
import { Api, Asset, CreditPack, PlanLimits, Series } from '../data/api';
import { Gates } from '../shell/gates';
import { lidOf, type Lid } from '../data/lids';

/** Modelos de ejemplo reales, generados con My3DStudio (public/showcase/provenance.json). */
const SHOWCASE = [
  { slug: 'dragon', name: 'Dragón de miniatura', prompt: 'Un dragón pequeño posado sobre una roca, figura de miniatura para juego de rol de mesa' },
  { slug: 'caballo', name: 'Caballo de ajedrez', prompt: 'La pieza de ajedrez del caballo con armadura medieval, sobre peana redonda' },
  { slug: 'estacion', name: 'Estación de maqueta', prompt: 'Una pequeña estación de tren rural de piedra y madera para maqueta de tren de jardín' },
  { slug: 'buho', name: 'Búho de cerámica', prompt: 'Un búho decorativo de cerámica sentado, con plumas talladas' },
  { slug: 'maceta', name: 'Maceta facetada', prompt: 'Una maceta geométrica facetada con una suculenta dentro' },
] as const;


/**
 * S01 portada: «La guía de pintado». Un modelo real gira sobre su peana y cuatro botes lo repintan:
 * foto, malla gris, textura y archivo. El primer bote es la zona de subida, con el coste en la tapa.
 */
@Component({
  selector: 'app-home',
  imports: [Icon, RouterLink, PaintingViewer, CurrencyPipe, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Primera vista: el modelo y la guía de cuatro botes, sobre gris imprimación -->
    <section aria-labelledby="hero-title" class="ground-primer -mt-[3.75rem] pt-[3.75rem]">
      <div class="max-w-[80rem] mx-auto px-4 sm:px-8 pt-6 sm:pt-10 pb-12 grid grid-cols-[minmax(0,1fr)] lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:content-start gap-x-8 gap-y-6">
        <div class="lg:col-span-5 lg:row-start-1 flex flex-col gap-4 lg:pt-4">
          <h1 id="hero-title" class="font-display uppercase text-[3.25rem] sm:text-[4.75rem] leading-[0.88]">De una foto a un modelo 3D</h1>
          <p class="text-sm sm:text-base max-w-[34ch]">Pagas solo lo que generas. El coste va impreso en la tapa, antes de empezar, y la descarga está incluida.</p>
        </div>

        <!-- El modelo, girando sobre su peana (en móvil, justo bajo el titular) -->
        <div class="min-w-0 lg:col-start-6 lg:col-span-7 lg:row-start-1 lg:row-span-2 flex flex-col gap-3">
          <app-painting-viewer class="h-[16.5rem] sm:h-[30rem] lg:h-[min(68svh,38rem)]"
            [url]="'/showcase/' + example().slug + '.glb'" [name]="example().name" [source]="example().prompt" [step]="viewStep()" />
          <div class="flex flex-col gap-2">
            <p id="examples-label" class="text-xs font-semibold">Ejemplos reales, hechos con My3DStudio a partir de una frase:</p>
            <div role="radiogroup" aria-labelledby="examples-label" class="flex sm:flex-wrap gap-2 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 pb-1">
              @for (e of examples; track e.slug) {
                <button type="button" role="radio" [attr.aria-checked]="example().slug === e.slug" (click)="example.set(e)"
                  class="h-8 px-3 shrink-0 rounded-pill border-2 border-ink text-xs font-semibold aria-checked:bg-ink aria-checked:text-bone hover:bg-ink/10">{{ e.name }}</button>
              }
            </div>
          </div>
        </div>

        <div class="lg:col-span-5 lg:row-start-2 flex flex-col gap-6">
          <!-- Bote 1: la zona de subida de verdad -->
          <div class="flex items-start gap-4" (mouseenter)="hoverFoto.set(true)" (mouseleave)="hoverFoto.set(false)"
            (focusin)="hoverFoto.set(true)" (focusout)="hoverFoto.set(false)">
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
              <div role="radiogroup" aria-label="Tipo de modelo" class="inline-flex p-1 rounded-pill bg-ink/90 self-start">
                <button type="button" role="radio" [attr.aria-checked]="series() === 'hd'" (click)="series.set('hd')"
                  class="h-8 px-3 rounded-pill text-xs font-semibold text-bone aria-checked:bg-bone aria-checked:text-ink">Alto detalle</button>
                <button type="button" role="radio" [attr.aria-checked]="series() === 'smart'" (click)="series.set('smart')"
                  class="h-8 px-3 rounded-pill text-xs font-semibold text-bone aria-checked:bg-bone aria-checked:text-ink">Topología limpia</button>
              </div>
              <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
                <button type="button" class="btn btn-primary btn-lg figures" (click)="go()">Generar · {{ cost }} créditos</button>
                <a routerLink="/crear" [queryParams]="{ serie: series() }" class="text-sm font-semibold underline">o descríbelo con palabras</a>
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
          <h2 id="guia" class="text-[3rem] sm:text-[3.75rem] uppercase leading-[0.9] lg:sticky lg:top-24">Cómo se pinta un modelo</h2>
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
          <p class="text-sm text-bone/85 max-w-[40ch]">En muchas herramientas descubres al final que descargar se paga aparte, que los créditos se
            esfuman a fin de mes o que cancelar es una carrera de obstáculos. Aquí no.</p>
        </div>
        <div class="lg:col-span-7 ground-bone px-5 sm:px-8 py-4 shadow-[0_12px_32px_rgb(0_0_0/0.35)]">
          <div class="flex items-baseline justify-between border-b-2 keyline pb-2 mb-1">
            <span class="font-display text-[1.5rem] font-extrabold uppercase leading-none">Contenido del bote</span>
            <span class="text-xs figures">6 garantías</span>
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
          <p class="text-sm max-w-[44ch]">Un modelo cuesta {{ cost }} créditos y lo ves antes de generar. Sin generaciones gratis: todo lo pagas
            antes, nunca después. Si una generación falla, te devolvemos los créditos.</p>
        </div>
        <ul class="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10">
          @for (o of offers(); track o.title) {
            <li class="flex flex-col items-center text-center gap-3">
              <span class="pot-lid w-32 h-32 sm:w-36 sm:h-36 rounded-full grid place-items-center" [attr.data-lid]="o.lid">
                <span class="flex flex-col items-center leading-none figures">
                  <span class="font-display text-[3rem] font-extrabold">{{ o.price | currency: 'EUR' : 'symbol' : '1.0-2' : 'es' }}</span>
                  <span class="text-xs font-semibold pt-1">{{ o.per }}</span>
                </span>
              </span>
              <span class="font-display text-[1.5rem] font-extrabold uppercase leading-none">{{ o.title }}</span>
              <span class="text-sm figures">≈ {{ o.models | number: '1.0-0' : 'es' }} modelos{{ o.note }}</span>
            </li>
          }
        </ul>
        <a routerLink="/precios" class="btn btn-lg bg-ink text-bone hover:bg-ink-soft self-start">Ver todos los precios <ui-icon name="arrow-right" /></a>
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
            <p class="text-sm text-bone/85 pt-2">Crear la cuenta es gratis. El pack de prueba son 3 modelos por 3 €, y no caduca.</p>
          </div>
        </div>
        <a routerLink="/crear" class="btn btn-primary btn-lg self-start sm:self-auto">Crear mi primer modelo <ui-icon name="arrow-right" /></a>
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
  protected readonly hoverFoto = signal(false);
  protected readonly step = signal<PaintStep>('textura');
  /** Al pasar por el bote 1, el modelo enseña de dónde salió. */
  protected readonly viewStep = computed<PaintStep>(() => (this.hoverFoto() ? 'foto' : this.step()));
  protected readonly examples = SHOWCASE;
  protected readonly example = signal<(typeof SHOWCASE)[number]>(SHOWCASE[0]);
  /** Créditos de un modelo (CREDITS_HD del servidor; la topología limpia cuesta lo mismo por variante). */
  protected readonly cost = 50;
  private file: File | null = null;
  private readonly assets = toSignal(this.api.assets(), { initialValue: [] as Asset[] });
  protected recent = () => this.assets().slice(0, 6);

  protected readonly pots: { step: PaintStep; n: number; label: string; lid: Lid }[] = [
    { step: 'malla', n: 2, label: 'Malla gris', lid: 'mustard' },
    { step: 'textura', n: 3, label: 'Textura', lid: 'blue' },
    { step: 'archivo', n: 4, label: 'Archivo', lid: 'green' },
  ];
  protected readonly guide: { title: string; text: string; gets: string; lid: Lid }[] = [
    { title: 'Foto', lid: 'red', gets: 'Coste visible: 50 créditos por modelo',
      text: 'Sube una foto con el objeto centrado y el fondo limpio, o descríbelo con una frase. Antes de pulsar Generar ves exactamente cuántos créditos gasta.' },
    { title: 'Malla gris', lid: 'mustard', gets: 'Alto detalle o topología limpia, de 500 a 25.000 polígonos',
      text: 'La forma sale en gris, como una figura recién imprimada. Elige alto detalle para imprimir o topología limpia si vas a animarla o editarla.' },
    { title: 'Textura', lid: 'blue', gets: 'Texturas 2K o 4K, con materiales PBR',
      text: 'El color se pinta sobre la malla. Gira el modelo en el visor y míralo por todos lados antes de descargarlo.' },
    { title: 'Archivo', lid: 'green', gets: 'GLB, OBJ, STL, 3MF, FBX y USDZ',
      text: 'Descárgalo para tu laminador, tu motor de juego, tu web o realidad aumentada. La descarga va incluida, sin pagar aparte.' },
  ];
  protected readonly promises = [
    { icon: 'zap', title: 'Ves antes de pagar', text: 'Si lo describes con texto, primero ves la imagen de la que saldrá el modelo, sin gastar créditos. Y el coste se muestra antes de empezar.' },
    { icon: 'download', title: 'Descarga incluida', text: 'Lo que generas se descarga en todos los formatos, sin pagar por exportar.' },
    { icon: 'history', title: 'Créditos que duran', text: 'Lo que no gastes un mes pasa al siguiente, y los packs no caducan nunca.' },
    { icon: 'rotate-ccw', title: 'Si falla, se devuelve', text: 'Una generación fallida o cancelada no cuesta nada: los créditos vuelven solos.' },
    { icon: 'x', title: 'Te vas cuando quieras', text: 'Cancelas desde tu cuenta, sin encuestas ni descuentos para retenerte.' },
    { icon: 'box', title: 'Listo para imprimir', text: 'Eliges la altura en milímetros y, si quieres, una peana. El STL o 3MF sale de pie, a tamaño real y con aviso si la malla tiene agujeros.' },
  ];
  protected readonly faq = [
    { q: '¿Qué es un crédito?', a: 'La unidad con la que pagas cada generación. Un modelo de alto detalle cuesta 50 créditos; el botón Generar siempre te dice el coste exacto.' },
    { q: '¿Hay plan gratis?', a: 'Crear la cuenta y mirar es gratis, pero cada modelo usa GPU de pago, así que no regalamos generaciones. Para probar, el pack de 3 € trae 3 modelos que no caducan.' },
    { q: '¿Qué pasa con los créditos que no gasto?', a: 'Los del mes pasan al mes siguiente (como mucho, lo de un mes). Los de los packs no caducan nunca.' },
    { q: '¿Y si el modelo sale mal o falla?', a: 'Si falla o la cancelas, se devuelven los créditos. Con texto puedes ver antes la imagen de la que saldrá, gratis, y pedir otra hasta que te convenza. Si el modelo sale pero no te gusta, reintentar cuesta lo mismo que generar, porque cada intento usa GPU de pago.' },
    { q: '¿Cómo cancelo?', a: 'En Tu cuenta → Gestionar o cancelar suscripción. Sin preguntas. Sigues con tu plan hasta el final del periodo pagado.' },
    { q: '¿Quién es dueño de los modelos?', a: 'Tú. Puedes usarlos comercialmente y mantenerlos privados, compres un pack o una suscripción.' },
  ];

  private readonly plans = signal<PlanLimits[]>([]);
  private readonly packs = signal<CreditPack[]>([]);
  /** Botes de precio, con los datos reales de la API (packs y planes de pago). */
  protected readonly offers = computed(() => {
    const out: { title: string; price: number; per: string; models: number; note: string; lid: Lid }[] = [];
    const k = this.packs();
    const trial = k.find((p) => p.id === 'pack_150') ?? k[0];
    const small = k.find((p) => p.id === 'pack_800');
    if (trial) out.push({ title: 'Pack de prueba', price: trial.priceCents / 100, per: 'una vez', models: (trial.credits + trial.bonusCredits) / this.cost, note: ', no caducan', lid: lidOf(trial.id) });
    if (small) out.push({ title: 'Pack', price: small.priceCents / 100, per: 'una vez', models: (small.credits + small.bonusCredits) / this.cost, note: ', no caducan', lid: lidOf(small.id) });
    for (const p of this.plans().filter((x) => x.priceMonthCents > 0).slice(0, 2)) {
      out.push({ title: p.name, price: p.priceMonthCents / 100, per: 'al mes', models: p.monthlyCredits / this.cost, note: ' al mes', lid: lidOf(p.id) });
    }
    return out;
  });

  constructor() {
    void this.api.plans().then((p) => this.plans.set(p)).catch(() => {});
    void this.api.creditPacks().then((k) => this.packs.set(k)).catch(() => {});
  }

  protected choose(s: PaintStep): void {
    this.step.set(this.step() === s ? 'textura' : s);
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
