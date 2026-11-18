import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { Modal } from '../../ui/modal';
import { Icon } from '../../ui/icon';
import { Api, ApiError, Asset, ExportFormat } from '../../data/api';
import { Gates } from '../../shell/gates';
import { Toasts } from '../../ui/toast';

interface FormatOption { id: ExportFormat; label: string; use: string; ready: boolean }

/** S08: exportar un modelo. FBX y 3MF se convierten en el servidor (trabajo convert). */
@Component({
  selector: 'app-export-modal',
  imports: [Modal, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-modal [open]="!!asset()" heading="Exportar modelo" size="md" (closed)="closed.emit()">
      @if (gates.me(); as me) {
        @if (me.plan.monthlyExportLimit !== null) {
          <p class="hint">Exportaciones este mes: {{ me.usage.exportsThisMonth }} de {{ me.plan.monthlyExportLimit }}.</p>
        }
      }
      <fieldset class="flex flex-col gap-2">
        <legend class="text-sm mb-2">Formato</legend>
        @for (f of formats; track f.id) {
          <label class="flex items-center gap-3 p-3 rounded-md border cursor-pointer"
            [class.border-highlight]="format() === f.id" [class.bg-highlight-surface]="format() === f.id"
            [class.border-border]="format() !== f.id" [class.opacity-50]="!f.ready" [class.cursor-not-allowed]="!f.ready">
            <input type="radio" name="format" class="sr-only" [value]="f.id" [checked]="format() === f.id"
              [disabled]="!f.ready" (change)="format.set(f.id)" />
            <span class="w-14 font-semibold text-sm uppercase">{{ f.label }}</span>
            <span class="text-sm text-text-muted flex-1">{{ f.use }}</span>
            @if (!f.ready) { <span class="badge">Con el backend</span> }
            @if (format() === f.id) { <ui-icon name="check" /> }
          </label>
        }
      </fieldset>
      @if (error()) { <p class="error-text" role="alert">{{ error() }}</p> }
      <div class="flex justify-end gap-2">
        <button type="button" class="btn btn-secondary" (click)="closed.emit()">Cancelar</button>
        <button type="button" class="btn btn-primary" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="download()">
          @if (busy()) { <ui-icon name="loader-circle" class="animate-spin" /> Preparando… } @else { <ui-icon name="download" /> Descargar }
        </button>
      </div>
    </ui-modal>
  `,
})
export class ExportModal {
  readonly asset = input<Asset | null>(null);
  readonly closed = output<void>();
  protected readonly gates = inject(Gates);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  protected readonly format = signal<ExportFormat>('glb');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly formats: FormatOption[] = [
    { id: 'glb', label: 'GLB', use: 'Web, AR y la mayoría de motores', ready: true },
    { id: 'obj', label: 'OBJ', use: 'Formato general para editores 3D', ready: true },
    { id: 'stl', label: 'STL', use: 'Impresión 3D (solo geometría)', ready: true },
    { id: 'usdz', label: 'USDZ', use: 'Realidad aumentada en dispositivos Apple', ready: true },
    { id: 'fbx', label: 'FBX', use: 'Unity, Unreal, Blender, Maya', ready: false },
    { id: '3mf', label: '3MF', use: 'Impresión 3D con color', ready: false },
  ];

  protected async download(): Promise<void> {
    const a = this.asset();
    if (!a) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const { url, filename } = await this.api.exportAsset(a.id, this.format());
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      this.toasts.show('success', `Descargando ${filename}`);
      this.closed.emit();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'export_limit') {
        this.closed.emit();
        this.gates.showPaywall('plan_feature', e.message);
      } else this.error.set(e instanceof ApiError ? e.message : 'No se ha podido exportar');
    } finally {
      this.busy.set(false);
    }
  }
}
