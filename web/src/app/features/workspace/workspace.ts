import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Api, ApiError, Asset, CreateTaskRequest, Estimate, GenerationParams, Privacy, Series, Task, TaskType, Upload,
} from '../../data/api';
import { Gates } from '../../shell/gates';
import { Toasts } from '../../ui/toast';
import { Icon } from '../../ui/icon';
import { Viewer } from '../viewer/viewer';
import { Dropzone } from './dropzone';
import { ExportModal } from './export-modal';
import { Handoff } from './handoff';

const TOOLS = [
  { id: 'model', label: 'Modelo', icon: 'box', ready: true },
  { id: 'segment', label: 'Piezas', icon: 'puzzle', ready: false },
  { id: 'retopo', label: 'Retopo', icon: 'grid-3x3', ready: false },
  { id: 'uv', label: 'UV', icon: 'scan', ready: false },
  { id: 'texture', label: 'Textura', icon: 'paintbrush', ready: false },
  { id: 'rig', label: 'Rig', icon: 'person-standing', ready: false },
];

/** S03 configurar, S04 generando, S05 resultado. Ruta /crear?serie=hd|smart&modelo=<id>&tarea=<id> */
@Component({
  selector: 'app-workspace',
  imports: [Icon, Viewer, Dropzone, ExportModal, FormsModule, DecimalPipe, DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './workspace.html',
})
export class Workspace {
  private readonly api = inject(Api);
  protected readonly gates = inject(Gates);
  private readonly toasts = inject(Toasts);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly handoff = inject(Handoff);

  protected readonly tools = TOOLS;
  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });

  // ---------------------------------------------------------------- formulario
  protected readonly series = signal<Series>('hd');
  protected readonly mode = signal<TaskType>('image_to_model');
  protected readonly upload = signal<Upload | null>(null);
  protected readonly uploading = signal(false);
  protected readonly uploadError = signal('');
  protected readonly prompt = signal('');
  protected readonly texturePrompt = signal('');
  protected readonly showTexturePrompt = signal(false);
  protected readonly settingsOpen = signal(false);
  protected readonly privacy = signal<Privacy>('public');
  protected readonly params = signal<GenerationParams>({
    textureResolution: '2k', pbr: true, texture: true, topology: 'quad', faceLimit: 10000, variants: 1,
  });
  protected readonly promptError = signal('');
  protected readonly submitting = signal(false);
  protected readonly estimate = signal<Estimate | null>(null);
  protected readonly faceLimitError = computed(() => {
    const f = this.params().faceLimit;
    return Number.isInteger(f) && f >= 500 && f <= 25000 ? '' : 'Elige entre 500 y 25 000 polígonos';
  });

  // ---------------------------------------------------------------- tareas y resultado
  protected readonly tasks = toSignal(this.api.tasks(), { initialValue: [] as Task[] });
  protected readonly selectedTaskId = computed(() => this.query().get('tarea'));
  protected readonly selectedAssetId = computed(() => this.query().get('modelo'));
  protected readonly selectedTask = computed(() => this.tasks().find((t) => t.id === this.selectedTaskId()) ?? null);
  protected readonly asset = signal<Asset | null>(null);
  protected readonly assetError = signal('');
  protected readonly exporting = signal<Asset | null>(null);
  protected readonly renaming = signal(false);
  protected readonly nameDraft = signal('');
  protected readonly variants = computed(() => {
    const t = this.selectedTask() ?? this.tasks().find((x) => x.assetIds.includes(this.selectedAssetId() ?? ''));
    return t && t.assetIds.length > 1 ? t.assetIds : [];
  });

  constructor() {
    // serie desde el menú "Crear"
    effect(() => {
      const s = this.query().get('serie');
      if (s === 'hd' || s === 'smart') untracked(() => this.series.set(s));
    });
    // imagen elegida en el inicio
    const pending = this.handoff.take();
    if (pending) {
      this.series.set(pending.series);
      // desde el inicio se genera directamente, como en el flujo F01
      void this.onFile(pending.file).then(() => this.upload() && this.generate());
    }
    // estimación de coste cuando cambia el formulario
    effect(() => {
      const req = this.request();
      this.api.estimate(req).then((e) => this.estimate.set(e), () => this.estimate.set(null));
    });
    // al terminar la tarea seleccionada, abrir su primer modelo
    effect(() => {
      const t = this.selectedTask();
      if (t?.status === 'success' && t.assetIds.length && !this.selectedAssetId()) {
        untracked(() => this.select({ modelo: t.assetIds[0], tarea: t.id }));
      }
    });
    // cargar el asset seleccionado
    effect(() => {
      const id = this.selectedAssetId();
      this.assetError.set('');
      if (!id) return this.asset.set(null);
      this.api.asset(id).then(
        (a) => this.asset.set(a),
        (e) => {
          this.asset.set(null);
          this.assetError.set(e instanceof ApiError ? e.message : 'No se ha podido abrir el modelo');
        },
      );
    });
  }

  private request(): Omit<CreateTaskRequest, 'idempotencyKey'> {
    return {
      type: this.mode(), series: this.series(),
      prompt: this.mode() === 'text_to_model' ? this.prompt() : undefined,
      texturePrompt: this.mode() === 'text_to_model' && this.texturePrompt() ? this.texturePrompt() : undefined,
      uploadId: this.mode() === 'image_to_model' ? this.upload()?.id : undefined,
      params: { ...this.params(), variants: this.series() === 'smart' ? this.params().variants : 1 },
      privacy: this.privacy(),
    };
  }

  protected setParam<K extends keyof GenerationParams>(k: K, v: GenerationParams[K]): void {
    this.params.update((p) => ({ ...p, [k]: v }));
  }

  protected select(q: { modelo?: string | null; tarea?: string | null }): void {
    void this.router.navigate([], { queryParams: q, queryParamsHandling: 'merge', replaceUrl: true });
  }

  // ---------------------------------------------------------------- acciones
  protected async onFile(file: File): Promise<void> {
    if (!(await this.gates.ensureSignedIn())) return;
    this.uploadError.set('');
    this.uploading.set(true);
    try {
      this.upload.set(await this.api.upload(file));
    } catch (e) {
      this.uploadError.set(e instanceof ApiError ? e.message : 'No se ha podido subir la imagen');
    } finally {
      this.uploading.set(false);
    }
  }

  protected async generate(): Promise<void> {
    // BUG-006: el bloqueo va antes de cualquier await; si no, un doble clic crea dos tareas
    if (this.submitting()) return;
    this.submitting.set(true);
    try {
      if (!(await this.gates.ensureSignedIn())) return;
      const req = this.request();
      // BUG-002: si la opción elegida no está en el plan, decirlo antes de pedir imagen o texto
      const early = await this.api.estimate(req).catch(() => null);
      if (early && !early.allowed && early.reason === 'plan_feature') {
        this.gates.showPaywall(early.reason, early.detail ?? 'No disponible');
        return;
      }
      if (req.type === 'image_to_model' && !req.uploadId) {
        this.uploadError.set('Sube una imagen para generar');
        return;
      }
      if (req.type === 'text_to_model' && !req.prompt?.trim()) {
        this.promptError.set('Describe el objeto que quieres crear');
        return;
      }
      if (req.series === 'smart' && this.faceLimitError()) return;
      const est = early ?? (await this.api.estimate(req));
      if (!est.allowed) {
        this.gates.showPaywall(est.reason, est.detail ?? 'No disponible');
        return;
      }
      const task = await this.api.createTask({ ...req, idempotencyKey: crypto.randomUUID() });
      this.select({ tarea: task.id, modelo: null });
      this.toasts.show('info', task.queuePosition ? 'En cola' : 'Generando tu modelo');
    } catch (e) {
      if (e instanceof ApiError && (e.status === 402 || e.status === 403)) this.gates.showPaywall(e.code as Estimate['reason'], e.message);
      else this.toasts.show('error', e instanceof ApiError ? e.message : 'No se ha podido crear la tarea');
    } finally {
      this.submitting.set(false);
    }
  }

  protected async cancel(t: Task): Promise<void> {
    try {
      await this.api.cancelTask(t.id);
      this.toasts.show('info', `Cancelada. Te hemos devuelto ${t.creditsCost} créditos`);
    } catch (e) {
      this.toasts.show('error', e instanceof ApiError ? e.message : 'No se ha podido cancelar');
    }
  }

  protected async retry(t: Task): Promise<void> {
    try {
      const nt = await this.api.retryTask(t.id, crypto.randomUUID());
      this.select({ tarea: nt.id, modelo: null });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 402 || e.status === 403)) this.gates.showPaywall(e.code as Estimate['reason'], e.message);
      else this.toasts.show('error', e instanceof ApiError ? e.message : 'No se ha podido reintentar');
    }
  }

  protected openTask(t: Task): void {
    this.select({ tarea: t.id, modelo: t.status === 'success' ? t.assetIds[0] : null });
  }

  protected startRename(a: Asset): void {
    this.nameDraft.set(a.name);
    this.renaming.set(true);
  }

  protected async saveName(a: Asset): Promise<void> {
    try {
      this.asset.set(await this.api.updateAsset(a.id, { name: this.nameDraft() }));
      this.renaming.set(false);
    } catch (e) {
      this.toasts.show('error', e instanceof ApiError ? e.message : 'No se ha podido renombrar');
    }
  }

  protected async togglePrivacy(a: Asset): Promise<void> {
    try {
      const next = a.privacy === 'public' ? 'private' : 'public';
      this.asset.set(await this.api.updateAsset(a.id, { privacy: next }));
      this.toasts.show('success', next === 'private' ? 'Ahora solo tú puedes verlo' : 'Ahora es público');
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) this.gates.showPaywall('plan_feature', e.message);
    }
  }

  protected statusLabel(t: Task): string {
    switch (t.status) {
      case 'queued': return t.queuePosition && t.queuePosition > 1 ? `En cola · ${t.queuePosition - 1} por delante` : 'En cola';
      case 'running': return `Generando · ${Math.floor(t.progress)} %`;
      case 'success': return 'Listo';
      case 'failed': return 'Ha fallado';
      case 'cancelled': return 'Cancelada';
    }
  }

  protected taskTitle(t: Task): string {
    return `${t.type === 'text_to_model' ? 'Texto' : 'Imagen'} · ${t.series === 'hd' ? 'Alto detalle' : 'Topología limpia'}`;
  }
}
