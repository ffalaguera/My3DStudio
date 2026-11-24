import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Modal } from '../../ui/modal';
import { Icon } from '../../ui/icon';
import { Api, ApiError, Asset, ExportFormat, PrintReport } from '../../data/api';
import { Gates } from '../../shell/gates';
import { Toasts } from '../../ui/toast';

interface FormatOption { id: ExportFormat; label: string; use: string }

/** S08: exportar un modelo. FBX y 3MF se convierten en el servidor (trabajo convert). */
@Component({
  selector: 'app-export-modal',
  imports: [Modal, Icon, DecimalPipe],
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
            [class.border-border]="format() !== f.id" [class.opacity-50]="!ready(f.id)" [class.cursor-not-allowed]="!ready(f.id)">
            <input type="radio" name="format" class="sr-only" [value]="f.id" [checked]="format() === f.id"
              [disabled]="!ready(f.id)" (change)="format.set(f.id)" />
            <span class="w-14 font-semibold text-sm uppercase">{{ f.label }}</span>
            <span class="text-sm text-text-muted flex-1">{{ f.use }}</span>
            @if (!ready(f.id)) { <span class="badge">Próximamente</span> }
            @if (format() === f.id) { <ui-icon name="check" /> }
          </label>
        }
      </fieldset>
      @if (printable()) {
        <!-- Kit de impresión: el archivo sale a tamaño real, de pie y apoyado en la cama -->
        <fieldset class="flex flex-col gap-3 p-3 rounded-md bg-surface" data-testid="print-options">
          <legend class="sr-only">Preparar para imprimir</legend>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" [checked]="prepare()" (change)="prepare.set(!prepare()); report.set(null)" />
            Preparar para imprimir
          </label>
          @if (prepare()) {
            <div class="flex flex-wrap items-end gap-4">
              <label class="label">Altura
                <span class="flex items-center gap-2">
                  <input type="number" min="10" max="400" step="1" class="field h-9 w-24 px-2 text-right figures"
                    [value]="heightMm()" (input)="heightMm.set(+$any($event.target).value); report.set(null)"
                    [attr.aria-invalid]="!!heightError()" aria-describedby="height-hint" />
                  <span class="text-sm">mm</span>
                </span>
              </label>
              <label class="flex items-center gap-2 text-sm h-9">
                <input type="checkbox" [checked]="base()" (change)="base.set(!base()); report.set(null)" />
                Añadir peana (2 mm)
              </label>
            </div>
            <p id="height-hint" [class]="heightError() ? 'error-text' : 'hint'">
              {{ heightError() || 'De pie, en milímetros y apoyado en la cama: listo para el laminador.' }}</p>
          }
        </fieldset>
      }
      @if (report(); as r) {
        <div role="status" class="p-3 rounded-md border text-sm flex flex-col gap-1"
          [class.border-success]="r.watertight" [class.border-warning]="!r.watertight" data-testid="print-report">
          <p class="font-semibold figures">{{ r.sizeMm.x }} × {{ r.sizeMm.y }} × {{ r.sizeMm.z }} mm · {{ r.triangles | number: '1.0-0' : 'es' }} triángulos</p>
          @if (r.watertight) {
            <p class="flex items-center gap-1"><ui-icon name="check" [size]="14" /> Malla cerrada: debería laminarse sin problemas.</p>
          } @else {
            <p class="flex items-start gap-1"><ui-icon name="circle-alert" [size]="14" class="mt-0.5" />
              La malla tiene {{ r.openEdges | number: '1.0-0' : 'es' }} bordes abiertos. La mayoría de laminadores los cierran solos;
              si el tuyo avisa, usa su opción de reparar.</p>
          }
        </div>
      }
      @if (error()) { <p class="error-text" role="alert">{{ error() }}</p> }
      <div class="flex justify-end gap-2">
        <button type="button" class="btn btn-secondary" (click)="closed.emit()">{{ report() ? 'Cerrar' : 'Cancelar' }}</button>
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
    { id: 'glb', label: 'GLB', use: 'Web, AR y la mayoría de motores' },
    { id: 'obj', label: 'OBJ', use: 'Formato general para editores 3D' },
    { id: 'stl', label: 'STL', use: 'Impresión 3D, cualquier laminador' },
    { id: 'usdz', label: 'USDZ', use: 'Realidad aumentada en dispositivos Apple' },
    { id: 'fbx', label: 'FBX', use: 'Unity, Unreal, Blender, Maya' },
    { id: '3mf', label: '3MF', use: 'Impresión 3D: Bambu Studio, PrusaSlicer, Cura' },
  ];
  private readonly available = signal<ExportFormat[]>(['glb']);
  protected readonly printable = computed(() => this.format() === 'stl' || this.format() === '3mf');
  protected readonly prepare = signal(true);
  protected readonly heightMm = signal(80);
  protected readonly base = signal(false);
  protected readonly report = signal<PrintReport | null>(null);
  protected readonly heightError = computed(() => {
    const h = this.heightMm();
    return Number.isInteger(h) && h >= 10 && h <= 400 ? '' : 'Elige una altura entre 10 y 400 mm';
  });

  constructor() {
    void this.api.capabilities().then((c) => this.available.set(c.exportFormats));
    // otro modelo u otro formato: el informe anterior ya no vale
    effect(() => {
      this.asset();
      this.format();
      untracked(() => { this.report.set(null); this.error.set(''); });
    });
  }

  protected ready(f: ExportFormat): boolean {
    return this.available().includes(f);
  }

  protected async download(): Promise<void> {
    const a = this.asset();
    if (!a) return;
    const print = this.printable() && this.prepare() ? { heightMm: this.heightMm(), base: this.base() } : undefined;
    if (print && this.heightError()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const { url, filename, print: rep } = await this.api.exportAsset(a.id, this.format(), print);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      this.toasts.show('success', `Descargando ${filename}`);
      // con el kit de impresión el diálogo se queda abierto para enseñar el informe
      if (rep) this.report.set(rep);
      else this.closed.emit();
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
