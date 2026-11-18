import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Icon } from './icon';

export interface ToastItem {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
  action?: { label: string; link: string };
}

@Injectable({ providedIn: 'root' })
export class Toasts {
  readonly items = signal<ToastItem[]>([]);
  private seq = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  show(kind: ToastItem['kind'], text: string, action?: ToastItem['action']): void {
    const id = ++this.seq;
    this.items.update((l) => [...l.slice(-2), { id, kind, text, action }]);
    this.schedule(id);
  }

  schedule(id: number): void {
    this.timers.set(id, setTimeout(() => this.dismiss(id), 5000));
  }

  pause(id: number): void {
    clearTimeout(this.timers.get(id));
  }

  dismiss(id: number): void {
    clearTimeout(this.timers.get(id));
    this.items.update((l) => l.filter((t) => t.id !== id));
  }
}

@Component({
  selector: 'ui-toasts',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fixed bottom-4 right-4 left-4 sm:left-auto sm:w-96 z-50 flex flex-col gap-2" aria-live="polite">
      @for (t of toasts.items(); track t.id) {
        <div [attr.role]="t.kind === 'error' ? 'alert' : 'status'"
          class="flex items-center gap-3 p-3 rounded-md bg-surface-2 shadow-float border-l-[3px]"
          [class.border-success]="t.kind === 'success'" [class.border-danger]="t.kind === 'error'"
          [class.border-highlight]="t.kind === 'info'"
          (mouseenter)="toasts.pause(t.id)" (mouseleave)="toasts.schedule(t.id)"
          (focusin)="toasts.pause(t.id)" (focusout)="toasts.schedule(t.id)">
          <ui-icon [name]="t.kind === 'success' ? 'check' : t.kind === 'error' ? 'circle-x' : 'info'"
            [class.text-success]="t.kind === 'success'" [class.text-danger]="t.kind === 'error'" />
          <span class="text-sm flex-1">{{ t.text }}</span>
          @if (t.action) {
            <button type="button" class="text-sm underline" (click)="go(t)">{{ t.action.label }}</button>
          }
          <button type="button" class="btn btn-icon" aria-label="Cerrar aviso" (click)="toasts.dismiss(t.id)"><ui-icon name="x" /></button>
        </div>
      }
    </div>
  `,
})
export class ToastHost {
  protected readonly toasts = inject(Toasts);
  private readonly router = inject(Router);

  protected go(t: ToastItem): void {
    this.toasts.dismiss(t.id);
    void this.router.navigateByUrl(t.action!.link);
  }
}
