import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, viewChild } from '@angular/core';
import { Icon } from './icon';

let seq = 0;

/** Modal sobre <dialog> nativo: foco atrapado, Esc cierra, el foco vuelve al disparador. */
@Component({
  selector: 'ui-modal',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg [attr.aria-labelledby]="titleId"
      class="m-auto w-[calc(100%-2rem)] rounded-xl bg-surface-2 text-text shadow-pop p-0 backdrop:bg-overlay/60"
      [class.max-w-sm]="size() === 'sm'" [class.max-w-lg]="size() === 'md'"
      (close)="closed.emit()" (click)="onBackdrop($event)">
      <div class="p-6 flex flex-col gap-4">
        <div class="flex items-start gap-4">
          <h2 [id]="titleId" class="text-lg flex-1">{{ heading() }}</h2>
          <button type="button" class="btn-icon btn" (click)="close()" aria-label="Cerrar"><ui-icon name="x" /></button>
        </div>
        <ng-content />
      </div>
    </dialog>
  `,
})
export class Modal {
  readonly open = input(false);
  readonly heading = input.required<string>();
  readonly size = input<'sm' | 'md'>('sm');
  readonly closed = output<void>();
  protected readonly titleId = `modal-title-${++seq}`;
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    effect(() => {
      const d = this.dlg().nativeElement;
      if (this.open() && !d.open) d.showModal();
      if (!this.open() && d.open) d.close();
    });
  }

  close(): void {
    this.dlg().nativeElement.close();
  }

  protected onBackdrop(e: MouseEvent): void {
    if (e.target === this.dlg().nativeElement) this.close();
  }
}
