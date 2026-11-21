import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Icon } from '../ui/icon';
import { Dropzone } from '../features/workspace/dropzone';
import { Handoff } from '../features/workspace/handoff';
import { Api, Asset, Series } from '../data/api';
import { Gates } from '../shell/gates';

/** S01: landing (replica/launch/landing.md) con la entrada rápida a generar + tus últimos modelos. */
@Component({
  selector: 'app-home',
  imports: [Icon, Dropzone, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="max-w-3xl mx-auto px-4 pt-12 sm:pt-20 pb-10 flex flex-col items-center gap-6 text-center">
      <h1 class="text-xl sm:text-display">
        De una foto a un modelo 3D. Pagas solo lo que generas.</h1>
      <p class="text-text-muted text-base max-w-xl">Ves el coste antes de generar, la descarga va incluida y, si algo falla, te devolvemos los créditos. Sin letra pequeña.</p>

      <div class="w-full panel p-4 flex flex-col gap-4 text-left">
        <app-dropzone [preview]="preview()" [error]="error()" (file)="pick($event)" (cleared)="clear()" />
        <div class="flex flex-wrap items-center gap-3">
          <div role="radiogroup" aria-label="Tipo de modelo" class="seg seg-accent">
            <button type="button" role="radio" [attr.aria-checked]="series() === 'hd'" (click)="series.set('hd')">Alto detalle</button>
            <button type="button" role="radio" [attr.aria-checked]="series() === 'smart'" (click)="series.set('smart')">Topología limpia</button>
          </div>
          <a routerLink="/crear" [queryParams]="{ serie: series() }" class="btn btn-ghost btn-sm"><ui-icon name="type" /> Prefiero describirlo</a>
          <button type="button" class="btn btn-primary ml-auto" (click)="go()">Generar <ui-icon name="arrow-right" /></button>
        </div>
      </div>
    </section>

    @if (gates.me() && recent().length) {
      <section aria-labelledby="recent-title" class="max-w-content mx-auto px-4 pb-16">
        <div class="flex items-center justify-between mb-3">
          <h2 id="recent-title" class="text-lg">Tus últimos modelos</h2>
          <a routerLink="/mis-modelos" class="text-sm text-text-muted underline">Ver todos</a>
        </div>
        <ul class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          @for (a of recent(); track a.id) {
            <li><a [routerLink]="['/crear']" [queryParams]="{ modelo: a.id }" class="block card overflow-hidden hover:ring-2 hover:ring-border-input">
              @if (a.thumbnailUrl) { <img [src]="a.thumbnailUrl" [alt]="a.name" class="aspect-square w-full object-cover" /> }
              @else { <span class="block aspect-square viewport-bg"></span> }
              <span class="block p-2 text-xs truncate">{{ a.name }}</span></a></li>
          }
        </ul>
      </section>
    }

    <section aria-labelledby="problema" class="max-w-content mx-auto px-4 py-12 grid md:grid-cols-2 gap-8 items-start">
      <div class="flex flex-col gap-3">
        <h2 id="problema" class="text-lg sm:text-xl">Generar en 3D no debería ser una trampa</h2>
        <p class="text-text-muted">En muchas herramientas descubres al final que para descargar tu modelo hay que pagar, que los créditos
          que no usaste se pierden a fin de mes o que cancelar la suscripción es una carrera de obstáculos.</p>
      </div>
      <p class="text-text-muted">My3DStudio funciona al revés: el precio está a la vista antes de pulsar Generar, lo que creas es tuyo para
        descargar y te vas cuando quieras desde tu cuenta.</p>
    </section>

    <section aria-labelledby="como" class="max-w-content mx-auto px-4 py-12 flex flex-col gap-6">
      <h2 id="como" class="text-lg sm:text-xl">Cómo funciona</h2>
      <ol class="grid sm:grid-cols-3 gap-4">
        @for (s of steps; track s.title; let i = $index) {
          <li class="card p-5 flex flex-col gap-2">
            <span class="w-8 h-8 rounded-full bg-accent text-on-accent grid place-items-center font-semibold">{{ i + 1 }}</span>
            <h3 class="text-base font-semibold">{{ s.title }}</h3>
            <p class="text-sm text-text-muted">{{ s.text }}</p>
          </li>
        }
      </ol>
    </section>

    <section aria-labelledby="ventajas" class="max-w-content mx-auto px-4 py-12 flex flex-col gap-6">
      <h2 id="ventajas" class="text-lg sm:text-xl">Lo que nos diferencia</h2>
      <ul class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        @for (f of features; track f.title) {
          <li class="card p-5 flex flex-col gap-2">
            <ui-icon [name]="f.icon" class="text-accent" [size]="22" />
            <h3 class="text-base font-semibold">{{ f.title }}</h3>
            <p class="text-sm text-text-muted">{{ f.text }}</p>
          </li>
        }
      </ul>
    </section>

    <section aria-labelledby="precio" class="max-w-content mx-auto px-4 py-12">
      <div class="card p-6 flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
        <div class="flex flex-col gap-1">
          <h2 id="precio" class="text-lg">Gratis para empezar, 15 € al mes para crear en serio</h2>
          <p class="text-sm text-text-muted">2 modelos al mes gratis. Creador: unos 30 modelos al mes. Packs sin caducidad desde 10 €.</p>
        </div>
        <a routerLink="/precios" class="btn btn-secondary">Ver precios</a>
      </div>
    </section>

    <section aria-labelledby="faq" class="max-w-3xl mx-auto px-4 py-12 flex flex-col gap-4">
      <h2 id="faq" class="text-lg sm:text-xl">Preguntas frecuentes</h2>
      @for (q of faq; track q.q) {
        <details class="card p-4 group">
          <summary class="cursor-pointer font-semibold flex items-center justify-between gap-2">{{ q.q }}
            <ui-icon name="chevron-down" class="transition-transform group-open:rotate-180" /></summary>
          <p class="text-sm text-text-muted mt-2">{{ q.a }}</p>
        </details>
      }
    </section>

    <section class="max-w-3xl mx-auto px-4 pt-6 pb-16 flex flex-col items-center gap-4 text-center">
      <h2 class="text-lg sm:text-xl">Prueba con una foto tuya</h2>
      <p class="text-text-muted">Tienes 2 modelos gratis al mes, sin tarjeta.</p>
      <a routerLink="/crear" class="btn btn-primary">Crear mi primer modelo <ui-icon name="arrow-right" /></a>
    </section>
  `,
})
export class Home {
  private readonly router = inject(Router);
  private readonly handoff = inject(Handoff);
  private readonly api = inject(Api);
  protected readonly gates = inject(Gates);
  protected readonly series = signal<Series>('hd');
  protected readonly steps = [
    { title: 'Sube una foto o descríbelo', text: 'JPG, PNG o WEBP de hasta 20 MB, o una frase. Mejor con el objeto centrado y fondo limpio.' },
    { title: 'Mira el coste y genera', text: 'El botón te dice cuántos créditos gasta. Alto detalle o topología limpia, tú eliges.' },
    { title: 'Descarga y usa', text: 'GLB, OBJ, STL, 3MF, FBX o USDZ: para tu motor, tu web, AR o tu impresora 3D.' },
  ];
  protected readonly features = [
    { icon: 'zap', title: 'El precio, antes', text: 'Cada generación muestra su coste en créditos antes de empezar. Sin sorpresas después.' },
    { icon: 'download', title: 'La descarga va incluida', text: 'Lo que generas se descarga, también en el plan Gratis. Sin pagar aparte por exportar.' },
    { icon: 'history', title: 'Tus créditos no se esfuman', text: 'Lo que no gastes un mes pasa al siguiente. Y los packs no caducan nunca.' },
    { icon: 'rotate-ccw', title: 'Si falla, te los devolvemos', text: 'Una generación fallida o cancelada no cuesta nada: los créditos vuelven solos a tu saldo.' },
    { icon: 'x', title: 'Te vas cuando quieras', text: 'Cancelas desde tu cuenta, sin encuestas ni descuentos para retenerte. El plan sigue hasta fin de mes.' },
    { icon: 'box', title: 'Listo para imprimir', text: 'STL y 3MF para tu laminador (el 3MF ya en milímetros), además de GLB, OBJ, FBX y USDZ para 3D y AR.' },
  ] as const;
  protected readonly faq = [
    { q: '¿Qué es un crédito?', a: 'La unidad con la que pagas cada generación. Un modelo de alto detalle cuesta 50 créditos; el botón Generar siempre te dice el coste exacto.' },
    { q: '¿Puedo descargar en el plan Gratis?', a: 'Sí. Los modelos que generas se descargan en GLB, OBJ, STL y 3MF. Los planes de pago añaden uso comercial, modelos privados y más resolución.' },
    { q: '¿Qué pasa con los créditos que no gasto?', a: 'Los del mes pasan al mes siguiente (como mucho, lo de un mes). Los de los packs no caducan nunca.' },
    { q: '¿Y si el modelo sale mal o la generación falla?', a: 'Si falla o la cancelas, se devuelven los créditos. Si sale pero no te gusta, cada plan incluye reintentos gratis.' },
    { q: '¿Cómo cancelo?', a: 'En Tu cuenta → Gestionar o cancelar suscripción. Sin preguntas. Sigues con tu plan hasta el final del periodo pagado.' },
    { q: '¿Quién es dueño de los modelos?', a: 'Tú. En los planes de pago puedes usarlos comercialmente y mantenerlos privados. En Gratis son públicos y de uso no comercial.' },
  ];
  protected readonly preview = signal<string | null>(null);
  protected readonly error = signal('');
  private file: File | null = null;
  private readonly assets = toSignal(this.api.assets(), { initialValue: [] as Asset[] });
  protected recent = () => this.assets().slice(0, 6);

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

  protected clear(): void {
    if (this.preview()) URL.revokeObjectURL(this.preview()!);
    this.preview.set(null);
    this.file = null;
  }

  protected go(): void {
    if (!this.file) {
      this.error.set('Elige primero una imagen');
      return;
    }
    this.handoff.pending = { file: this.file, series: this.series() };
    void this.router.navigate(['/crear'], { queryParams: { serie: this.series() } });
  }
}
