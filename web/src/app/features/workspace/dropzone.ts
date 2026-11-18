import { ChangeDetectionStrategy, Component, ElementRef, HostListener, input, output, signal, viewChild } from '@angular/core';
import { Icon } from '../../ui/icon';

/** Dropzone (single) de components.md: clic, arrastrar o pegar con Ctrl+V. */
@Component({
  selector: 'app-dropzone',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input #file type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" tabindex="-1" aria-hidden="true"
      (change)="picked($event)" />
    @if (preview(); as src) {
      <div class="relative rounded-lg checker overflow-hidden h-48 grid place-items-center">
        <img [src]="src" alt="Imagen de referencia subida" class="max-h-full max-w-full object-contain" />
        <div class="absolute top-2 right-2 flex gap-1">
          <button type="button" class="btn btn-icon bg-surface-2/90" aria-label="Cambiar imagen" (click)="open()"><ui-icon name="replace" /></button>
          <button type="button" class="btn btn-icon bg-surface-2/90" aria-label="Quitar imagen" (click)="cleared.emit()"><ui-icon name="x" /></button>
        </div>
      </div>
    } @else {
      <button type="button" (click)="open()" [disabled]="busy()"
        (dragover)="over($event)" (dragleave)="dragging.set(false)" (drop)="drop($event)"
        [attr.aria-describedby]="error() ? 'dz-error' : 'dz-hint'"
        class="w-full h-48 rounded-lg border border-dashed flex flex-col items-center justify-center gap-2 p-4 text-center transition-colors duration-fast"
        [class.border-border-input]="!dragging() && !error()" [class.bg-surface]="!dragging()"
        [class.border-highlight]="dragging()" [class.bg-highlight-surface]="dragging()" [class.border-danger]="!!error() && !dragging()">
        @if (busy()) {
          <ui-icon name="loader-circle" [size]="28" class="animate-spin text-text-muted" />
          <span class="text-sm">Subiendo imagen…</span>
        } @else if (dragging()) {
          <ui-icon name="arrow-down-to-line" [size]="28" /><span class="text-sm">Suelta para subir</span>
        } @else {
          <ui-icon name="upload" [size]="28" class="text-text-muted" />
          <span class="text-sm">Arrastra una imagen, pégala o haz clic</span>
          <span id="dz-hint" class="hint">JPG, PNG o WEBP · hasta 20 MB · mínimo 256 px</span>
        }
      </button>
      @if (error()) { <p id="dz-error" class="error-text mt-2" role="alert">{{ error() }}</p> }
    }
  `,
})
export class Dropzone {
  readonly preview = input<string | null>(null);
  readonly busy = input(false);
  readonly error = input('');
  readonly file = output<File>();
  readonly cleared = output<void>();
  protected readonly dragging = signal(false);
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('file');

  open(): void {
    this.input().nativeElement.click();
  }

  protected picked(e: Event): void {
    const el = e.target as HTMLInputElement;
    const f = el.files?.[0];
    if (f) this.file.emit(f);
    el.value = '';
  }

  protected over(e: DragEvent): void {
    e.preventDefault();
    this.dragging.set(true);
  }

  protected drop(e: DragEvent): void {
    e.preventDefault();
    this.dragging.set(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) this.file.emit(f);
  }

  @HostListener('document:paste', ['$event'])
  protected paste(e: ClipboardEvent): void {
    if (this.preview() || this.busy()) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
    const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith('image/'));
    if (f) this.file.emit(f);
  }
}
