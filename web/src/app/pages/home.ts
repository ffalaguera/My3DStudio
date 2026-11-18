import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Icon } from '../ui/icon';
import { Dropzone } from '../features/workspace/dropzone';
import { Handoff } from '../features/workspace/handoff';
import { Api, Asset, Series } from '../data/api';
import { Gates } from '../shell/gates';

/** S01: entrada rápida a generar + tus últimos modelos. */
@Component({
  selector: 'app-home',
  imports: [Icon, Dropzone, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="max-w-3xl mx-auto px-4 pt-12 sm:pt-20 pb-10 flex flex-col items-center gap-6 text-center">
      <h1 class="text-xl sm:text-display">
        De una foto a un modelo 3D</h1>
      <p class="text-text-muted text-base max-w-xl">Sube una imagen, elige cuánto detalle necesitas y descárgalo listo para tu motor, tu web o tu impresora.</p>

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
