import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, distinctUntilChanged, filter, map } from 'rxjs';
import {
  Api, ApiError, Asset, AssetFilter, Capabilities, CreateTaskRequest, Estimate, ExportFormat, LedgerEntry, Me,
  CreditPack, PlanLimits, Privacy, Profile, Task, Upload,
} from './api';
import type { ModelSpec } from './fake-model';
import type * as THREE from 'three';

// three.js y el generador se cargan bajo demanda para no inflar el paquete inicial.
const modelKit = () => import('./fake-model');

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Color pastel estable a partir de un texto (para los modelos creados desde texto). */
function colorFromText(text: string): string {
  const hue = hashString(text) % 360;
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    // HSL → RGB con saturación 0,45 y luminosidad 0,55
    const c = 0.55 - 0.45 * Math.min(0.55, 1 - 0.55) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Implementación en el navegador de la API de architecture.md. Reproduce las reglas del backend:
// congelar/consumir/liberar créditos, concurrencia por plan, límites, idempotencia, caducidad.
// Estado en localStorage para sobrevivir a recargas. Se sustituye por HttpApi en /replica-backend.
//
// Para probar estados: un prompt o nombre de archivo que contenga "fallo" hace fallar la tarea al 30 %.

const STORE_KEY = 'my3dstudio:fake-api:v1';
const TICK_MS = 400;
const DEMO_SECONDS = { hd: 18, smart: 8 } as const;

// Tarifa de lanzamiento (replica/launch/pricing.md); igual que la migración 0003 del servidor.
const PLANS: PlanLimits[] = [
  { id: 'free', name: 'Gratis', priceMonthCents: 0, priceYearCents: 0, currency: 'eur', monthlyCredits: 100,
    maxConcurrentTasks: 1, maxVariants: 1, monthlyExportLimit: null, maxSavedModels: 10, historyDays: 1,
    maxTextureResolution: '2k', allowPrivate: false, allowCommercial: false, allowSmartMesh: false },
  { id: 'pro', name: 'Creador', priceMonthCents: 1500, priceYearCents: 15000, currency: 'eur', monthlyCredits: 1500,
    maxConcurrentTasks: 5, maxVariants: 4, monthlyExportLimit: null, maxSavedModels: null, historyDays: 7,
    maxTextureResolution: '4k', allowPrivate: true, allowCommercial: true, allowSmartMesh: true },
  { id: 'max', name: 'Estudio', priceMonthCents: 4900, priceYearCents: 49000, currency: 'eur', monthlyCredits: 5000,
    maxConcurrentTasks: 20, maxVariants: 4, monthlyExportLimit: null, maxSavedModels: null, historyDays: null,
    maxTextureResolution: '8k', allowPrivate: true, allowCommercial: true, allowSmartMesh: true },
];

const PACKS: CreditPack[] = [
  { id: 'pack_800', credits: 800, bonusCredits: 0, priceCents: 1000, currency: 'eur', purchasable: true },
  { id: 'pack_2600', credits: 2400, bonusCredits: 200, priceCents: 3000, currency: 'eur', purchasable: true },
  { id: 'pack_9000', credits: 8000, bonusCredits: 1000, priceCents: 9000, currency: 'eur', purchasable: true },
];

interface StoredTask extends Task {
  frozen: { monthly: number; permanent: number };
  frozenInCycle: string; // cycleEndsAt cuando se congeló
  privacy: Privacy;
  idempotencyKey: string;
  color: string;
  uploadName?: string;
  startedAt?: string;
}
interface StoredAsset extends Omit<Asset, 'glbUrl'> { spec: ModelSpec }
interface StoredUpload extends Upload { color: string; name: string }

interface State {
  profile: Profile | null;
  planId: string;
  credits: { monthly: number; permanent: number; frozen: number; cycleEndsAt: string };
  ledger: LedgerEntry[];
  tasks: StoredTask[];
  assets: StoredAsset[];
  uploads: StoredUpload[];
  exports: string[]; // fechas ISO
}

const empty = (): State => ({
  profile: null, planId: 'free',
  credits: { monthly: 0, permanent: 0, frozen: 0, cycleEndsAt: nextCycle().toISOString() },
  ledger: [], tasks: [], assets: [], uploads: [], exports: [],
});

function nextCycle(from = new Date()): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
}
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cssColor(varName: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v ? `rgb(${v.split(/\s+/).join(',')})` : '#141518';
}

@Injectable()
export class FakeApi extends Api implements OnDestroy {
  private readonly state$ = new BehaviorSubject<State>(this.load());
  private readonly models = new Map<string, THREE.Group>();
  private readonly glbUrls = new Map<string, string>();
  private readonly completing = new Set<string>();
  private readonly timer = setInterval(() => this.tick(), TICK_MS);

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  // ------------------------------------------------------------------ estado
  private get s(): State {
    return this.state$.value;
  }
  private load(): State {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? { ...empty(), ...JSON.parse(raw) } : empty();
    } catch {
      return empty();
    }
  }
  private commit(mut: (s: State) => void): void {
    const next = structuredClone(this.s);
    mut(next);
    this.state$.next(next);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      /* almacenamiento lleno o bloqueado: el estado sigue en memoria */
    }
  }
  private plan(s = this.s): PlanLimits {
    return PLANS.find((p) => p.id === s.planId) ?? PLANS[0];
  }
  private requireUser(): Profile {
    if (!this.s.profile) throw new ApiError(401, 'not_signed_in', 'Inicia sesión para continuar');
    return this.s.profile;
  }
  private ledgerAdd(s: State, e: Omit<LedgerEntry, 'id' | 'createdAt'>): void {
    s.ledger.unshift({ ...e, id: id(), createdAt: now() });
  }

  async capabilities(): Promise<Capabilities> {
    return { exportFormats: ['glb', 'obj', 'stl', 'usdz'], billing: 'simulated' };
  }

  async billingPortal(): Promise<void> {
    throw new ApiError(501, 'billing_disabled', 'En la versión de demostración el plan se cambia desde Precios');
  }

  // ------------------------------------------------------------------ sesión
  session(): Observable<Profile | null> {
    return this.state$.pipe(map((s) => s.profile), distinctUntilChanged((a, b) => a?.id === b?.id));
  }

  async signIn(method: 'google' | 'email', email?: string): Promise<Profile> {
    await sleep(500);
    const addr = method === 'email' ? (email ?? '').trim() : 'persona@ejemplo.com';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) throw new ApiError(422, 'invalid_email', 'Escribe un email válido');
    const firstTime = !this.s.ledger.length;
    const profile: Profile = { id: this.s.profile?.id ?? id(), email: addr, displayName: addr.split('@')[0] };
    this.commit((s) => {
      s.profile = profile;
      if (firstTime) {
        s.credits.monthly = this.plan(s).monthlyCredits;
        this.ledgerAdd(s, { delta: s.credits.monthly, bucket: 'monthly', reason: 'grant', note: 'Créditos de bienvenida' });
      }
    });
    return profile;
  }

  async signOut(): Promise<void> {
    this.commit((s) => (s.profile = null));
  }

  // ------------------------------------------------------------------ cuenta
  me(): Observable<Me | null> {
    return this.state$.pipe(
      map((s) => {
        if (!s.profile) return null;
        const month = new Date().toISOString().slice(0, 7);
        return {
          profile: s.profile,
          plan: this.plan(s),
          credits: { ...s.credits, available: s.credits.monthly + s.credits.permanent },
          usage: {
            exportsThisMonth: s.exports.filter((d) => d.startsWith(month)).length,
            savedModels: s.assets.length,
            activeTasks: s.tasks.filter((t) => t.status === 'queued' || t.status === 'running').length,
          },
        };
      }),
    );
  }

  async plans(): Promise<PlanLimits[]> {
    return structuredClone(PLANS);
  }

  async ledger(): Promise<LedgerEntry[]> {
    this.requireUser();
    return structuredClone(this.s.ledger);
  }

  // ------------------------------------------------------------------ subidas
  async upload(file: File): Promise<Upload> {
    this.requireUser();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
      throw new ApiError(415, 'unsupported_type', 'Formato no admitido. Usa JPG, PNG o WEBP');
    if (file.size > 20 * 1024 * 1024)
      throw new ApiError(413, 'too_large', `La imagen pesa ${(file.size / 1048576).toFixed(0)} MB. El máximo es 20 MB`);
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) throw new ApiError(422, 'invalid_image', 'No se puede leer la imagen');
    if (Math.min(bitmap.width, bitmap.height) < 256)
      throw new ApiError(422, 'too_small', 'La imagen es demasiado pequeña: mínimo 256 px por lado');
    // Vista previa reducida y color medio (lo que haría POST /uploads/:id/complete).
    const side = 256;
    const scale = side / Math.max(bitmap.width, bitmap.height);
    const c = document.createElement('canvas');
    c.width = Math.round(bitmap.width * scale);
    c.height = Math.round(bitmap.height * scale);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, c.width, c.height);
    const px = ctx.getImageData(Math.round(c.width * 0.25), Math.round(c.height * 0.25),
      Math.max(1, Math.round(c.width / 2)), Math.max(1, Math.round(c.height / 2))).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < px.length; i += 16) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
    const color = '#' + [r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('');
    const up: StoredUpload = {
      id: id(), previewUrl: c.toDataURL('image/jpeg', 0.8), width: bitmap.width, height: bitmap.height,
      sizeBytes: file.size, color, name: file.name,
    };
    await sleep(300);
    this.commit((s) => {
      s.uploads = [up, ...s.uploads].slice(0, 20);
    });
    return up;
  }

  // ------------------------------------------------------------------ tareas
  private cost(req: Pick<CreateTaskRequest, 'series' | 'params'>): number {
    if (req.series === 'smart') return 50 * req.params.variants;
    const tex = req.params.texture ? { '2k': 0, '4k': 10, '8k': 20 }[req.params.textureResolution] : 0;
    return 50 + tex;
  }

  async estimate(req: Omit<CreateTaskRequest, 'idempotencyKey'>): Promise<Estimate> {
    const credits = this.cost(req);
    const etaSeconds = DEMO_SECONDS[req.series];
    if (!this.s.profile) return { credits, etaSeconds, allowed: false, reason: 'not_signed_in' };
    const plan = this.plan();
    const deny = (detail: string): Estimate => ({ credits, etaSeconds, allowed: false, reason: 'plan_feature', detail });
    if (req.series === 'smart' && !plan.allowSmartMesh) return deny('La topología limpia está en los planes de pago');
    if (req.privacy === 'private' && !plan.allowPrivate) return deny('Los modelos privados están en los planes de pago');
    if (req.params.variants > plan.maxVariants) return deny(`Tu plan permite ${plan.maxVariants} variante por generación`);
    const order = ['2k', '4k', '8k'];
    if (req.params.texture && order.indexOf(req.params.textureResolution) > order.indexOf(plan.maxTextureResolution))
      return deny(`Las texturas ${req.params.textureResolution.toUpperCase()} no están en tu plan`);
    if (plan.maxSavedModels !== null && this.s.assets.length + req.params.variants > plan.maxSavedModels)
      return deny(`Has llegado a ${plan.maxSavedModels} modelos guardados. Borra alguno o mejora tu plan`);
    const available = this.s.credits.monthly + this.s.credits.permanent;
    if (available < credits)
      return { credits, etaSeconds, allowed: false, reason: 'insufficient_credits',
        detail: `Te faltan ${credits - available} créditos` };
    const busy = this.s.tasks.filter((t) => t.status === 'queued' || t.status === 'running').length;
    return { credits, etaSeconds: etaSeconds * (1 + Math.floor(busy / plan.maxConcurrentTasks)), allowed: true };
  }

  async createTask(req: CreateTaskRequest): Promise<Task> {
    this.requireUser();
    const dup = this.s.tasks.find((t) => t.idempotencyKey === req.idempotencyKey);
    if (dup) return this.publicTask(dup);
    if (req.type === 'text_to_model' && !req.prompt?.trim()) throw new ApiError(422, 'prompt_required', 'Describe el objeto');
    const upload = req.uploadId ? this.s.uploads.find((u) => u.id === req.uploadId) : undefined;
    if (req.type === 'image_to_model' && !upload) throw new ApiError(422, 'upload_required', 'Sube una imagen');
    const est = await this.estimate(req);
    if (!est.allowed) {
      throw new ApiError(est.reason === 'insufficient_credits' ? 402 : 403, est.reason!, est.detail ?? 'No permitido');
    }
    const cost = est.credits;
    const task: StoredTask = {
      id: id(), type: req.type, series: req.series, status: 'queued', progress: 0, queuePosition: null,
      prompt: req.prompt?.trim(), inputPreviewUrl: upload?.previewUrl, params: req.params, creditsCost: cost,
      assetIds: [], createdAt: now(), idempotencyKey: req.idempotencyKey, frozen: { monthly: 0, permanent: 0 },
      frozenInCycle: this.s.credits.cycleEndsAt, privacy: req.privacy,
      color: upload?.color ?? colorFromText(req.prompt ?? ''),
      uploadName: upload?.name,
    };
    this.commit((s) => {
      // congelar: primero la bolsa mensual
      const fromMonthly = Math.min(s.credits.monthly, cost);
      const fromPermanent = cost - fromMonthly;
      s.credits.monthly -= fromMonthly;
      s.credits.permanent -= fromPermanent;
      s.credits.frozen += cost;
      task.frozen = { monthly: fromMonthly, permanent: fromPermanent };
      if (fromMonthly) this.ledgerAdd(s, { delta: -fromMonthly, bucket: 'monthly', reason: 'freeze', note: `Reserva para la tarea ${task.id.slice(0, 8)}` });
      if (fromPermanent) this.ledgerAdd(s, { delta: -fromPermanent, bucket: 'permanent', reason: 'freeze', note: `Reserva para la tarea ${task.id.slice(0, 8)}` });
      s.tasks.unshift(task);
    });
    return this.publicTask(task);
  }

  private publicTask(t: StoredTask): Task {
    const { frozen, frozenInCycle, privacy, idempotencyKey, color, uploadName, startedAt, ...pub } = t;
    void frozen; void frozenInCycle; void privacy; void idempotencyKey; void color; void uploadName; void startedAt;
    return structuredClone(pub);
  }

  tasks(): Observable<Task[]> {
    return this.state$.pipe(map((s) => s.tasks.slice(0, 30).map((t) => this.publicTask(t))));
  }

  taskEvents(taskId: string): Observable<Task> {
    return this.state$.pipe(
      map((s) => s.tasks.find((t) => t.id === taskId)),
      filter((t): t is StoredTask => !!t),
      map((t) => this.publicTask(t)),
      distinctUntilChanged((a, b) => a.status === b.status && a.progress === b.progress && a.queuePosition === b.queuePosition),
    );
  }

  async cancelTask(taskId: string): Promise<Task> {
    const t = this.s.tasks.find((x) => x.id === taskId);
    if (!t) throw new ApiError(404, 'not_found', 'La tarea no existe');
    if (t.status !== 'queued') throw new ApiError(409, 'not_cancellable', 'Solo se pueden cancelar las tareas en cola');
    this.commit((s) => this.finish(s, s.tasks.find((x) => x.id === taskId)!, 'cancelled'));
    return this.publicTask(this.s.tasks.find((x) => x.id === taskId)!);
  }

  async retryTask(taskId: string, idempotencyKey: string): Promise<Task> {
    const t = this.s.tasks.find((x) => x.id === taskId);
    if (!t) throw new ApiError(404, 'not_found', 'La tarea no existe');
    const upload = this.s.uploads.find((u) => u.previewUrl === t.inputPreviewUrl);
    return this.createTask({
      type: t.type, series: t.series, prompt: t.prompt, uploadId: upload?.id, params: t.params,
      privacy: 'public', idempotencyKey,
    });
  }

  /** Libera o consume los créditos congelados y cierra la tarea (una sola vez). */
  private finish(s: State, t: StoredTask, status: 'success' | 'failed' | 'cancelled', error?: string): void {
    if (t.status === 'success' || t.status === 'failed' || t.status === 'cancelled') return;
    t.status = status;
    t.finishedAt = now();
    t.queuePosition = null;
    if (error) t.errorMessage = error;
    s.credits.frozen -= t.frozen.monthly + t.frozen.permanent;
    const short = t.id.slice(0, 8);
    for (const bucket of ['monthly', 'permanent'] as const) {
      const amount = t.frozen[bucket];
      if (!amount) continue;
      if (status === 'success') {
        this.ledgerAdd(s, { delta: -amount, bucket, reason: 'consume', note: `Generación ${short}` });
      } else if (bucket === 'monthly' && t.frozenInCycle !== s.credits.cycleEndsAt) {
        // créditos de un ciclo que ya caducó: se liberan y se dan por caducados
        this.ledgerAdd(s, { delta: amount, bucket, reason: 'release', note: `Devolución ${short}` });
        this.ledgerAdd(s, { delta: -amount, bucket, reason: 'expire', note: 'Créditos del ciclo anterior' });
      } else {
        s.credits[bucket] += amount;
        this.ledgerAdd(s, { delta: amount, bucket, reason: 'release', note: `Devolución ${short}` });
      }
    }
  }

  private tick(): void {
    const s = this.s;
    const active = s.tasks.some((t) => t.status === 'queued' || t.status === 'running');
    const expired = s.assets.some((a) => a.expiresAt && new Date(a.expiresAt) < new Date());
    if (!active && !expired) return;
    const finished: { task: StoredTask; ok: boolean }[] = [];
    this.commit((st) => {
      st.assets = st.assets.filter((a) => !a.expiresAt || new Date(a.expiresAt) >= new Date());
      const plan = this.plan(st);
      let running = st.tasks.filter((t) => t.status === 'running').length;
      // las más antiguas primero
      for (const t of [...st.tasks].reverse()) {
        if (t.status === 'queued' && running < plan.maxConcurrentTasks) {
          t.status = 'running';
          t.startedAt = now();
          running++;
        }
      }
      let pos = 1;
      for (const t of [...st.tasks].reverse()) if (t.status === 'queued') t.queuePosition = pos++;
      for (const t of st.tasks) {
        if (t.status !== 'running') continue;
        const step = (100 * TICK_MS) / (DEMO_SECONDS[t.series] * 1000) * t.params.variants ** 0.3;
        t.progress = Math.min(99, Math.round((t.progress + step) * 10) / 10);
        const fails = /fallo/i.test(`${t.prompt ?? ''} ${t.uploadName ?? ''}`);
        if (fails && t.progress >= 30) {
          this.finish(st, t, 'failed', 'El motor no ha podido reconstruir este objeto');
          finished.push({ task: t, ok: false });
        } else if (t.progress >= 99) {
          finished.push({ task: t, ok: true });
        }
      }
    });
    for (const f of finished.filter((x) => x.ok)) void this.complete(f.task.id);
  }

  /** postprocess: crea un asset por variante con miniatura y estadísticas, y consume los créditos. */
  private async complete(taskId: string): Promise<void> {
    const t = this.s.tasks.find((x) => x.id === taskId);
    if (!t || t.status !== 'running' || this.completing.has(taskId)) return;
    this.completing.add(taskId);
    const { buildModel, stats, renderThumbnail } = await modelKit();
    const plan = this.plan();
    const bg = cssColor('--color-surface');
    const created: StoredAsset[] = [];
    for (let i = 0; i < t.params.variants; i++) {
      const spec: ModelSpec = {
        seed: hashString(`${t.id}:${i}`), series: t.series, color: t.color,
        faceLimit: t.series === 'smart' ? t.params.faceLimit : 200000, texture: t.params.texture,
      };
      const group = buildModel(spec);
      const st = stats(group);
      const assetId = id();
      this.models.set(assetId, group);
      const base = t.prompt ? t.prompt.slice(0, 40) : (t.uploadName ?? 'Modelo').replace(/\.[^.]+$/, '');
      created.push({
        id: assetId, taskId: t.id, name: t.params.variants > 1 ? `${base} (${i + 1})` : base, prompt: t.prompt,
        series: t.series, thumbnailUrl: renderThumbnail(group, bg), faceCount: st.faces, vertexCount: st.vertices,
        topology: t.series === 'smart' ? t.params.topology : 'tri',
        textureResolution: t.params.texture ? t.params.textureResolution : null, hasTexture: t.params.texture,
        privacy: t.privacy ?? 'public', license: plan.allowCommercial ? 'commercial' : 'attribution',
        expiresAt: plan.historyDays ? new Date(Date.now() + plan.historyDays * 86400000).toISOString() : null,
        createdAt: now(), spec,
      });
    }
    this.commit((s) => {
      const st = s.tasks.find((x) => x.id === taskId)!;
      st.progress = 100;
      st.assetIds = created.map((a) => a.id);
      this.finish(s, st, 'success');
      s.assets.unshift(...created);
    });
    this.completing.delete(taskId);
  }

  // ------------------------------------------------------------------ assets
  private publicAsset(a: StoredAsset): Asset {
    const { spec, ...pub } = a;
    void spec;
    return { ...structuredClone(pub), glbUrl: this.glbUrls.get(a.id) ?? '' };
  }

  private async model(a: StoredAsset): Promise<THREE.Group> {
    let g = this.models.get(a.id);
    if (!g) {
      g = (await modelKit()).buildModel(a.spec);
      this.models.set(a.id, g);
    }
    return g;
  }

  assets(f: AssetFilter = {}): Observable<Asset[]> {
    const q = f.q?.trim().toLowerCase();
    return this.state$.pipe(
      map((s) => s.assets
        .filter((a) => !q || a.name.toLowerCase().includes(q))
        .filter((a) => !f.series || a.series === f.series)
        .filter((a) => f.hasTexture === undefined || a.hasTexture === f.hasTexture)
        .map((a) => this.publicAsset(a))),
    );
  }

  async asset(assetId: string): Promise<Asset> {
    const a = this.s.assets.find((x) => x.id === assetId);
    if (!a) throw new ApiError(404, 'not_found', 'Este modelo ya no existe');
    if (!this.glbUrls.has(a.id)) {
      const blob = await (await modelKit()).exportModel(await this.model(a), 'glb');
      this.glbUrls.set(a.id, URL.createObjectURL(blob));
    }
    return this.publicAsset(a);
  }

  async updateAsset(assetId: string, patch: { name?: string; privacy?: Privacy }): Promise<Asset> {
    const a = this.s.assets.find((x) => x.id === assetId);
    if (!a) throw new ApiError(404, 'not_found', 'Este modelo ya no existe');
    if (patch.privacy === 'private' && !this.plan().allowPrivate)
      throw new ApiError(403, 'plan_feature', 'Los modelos privados están en los planes de pago');
    const name = patch.name?.trim();
    if (patch.name !== undefined && (!name || name.length > 120))
      throw new ApiError(422, 'invalid_name', 'El nombre debe tener entre 1 y 120 caracteres');
    this.commit((s) => {
      const t = s.assets.find((x) => x.id === assetId)!;
      if (name) t.name = name;
      if (patch.privacy) t.privacy = patch.privacy;
    });
    return this.publicAsset(this.s.assets.find((x) => x.id === assetId)!);
  }

  async deleteAsset(assetId: string): Promise<void> {
    const url = this.glbUrls.get(assetId);
    if (url) URL.revokeObjectURL(url);
    this.glbUrls.delete(assetId);
    this.models.delete(assetId);
    this.commit((s) => (s.assets = s.assets.filter((a) => a.id !== assetId)));
  }

  async exportAsset(assetId: string, format: ExportFormat): Promise<{ url: string; filename: string }> {
    this.requireUser();
    const a = this.s.assets.find((x) => x.id === assetId);
    if (!a) throw new ApiError(404, 'not_found', 'Este modelo ya no existe');
    const plan = this.plan();
    const month = new Date().toISOString().slice(0, 7);
    const used = this.s.exports.filter((d) => d.startsWith(month)).length;
    if (plan.monthlyExportLimit !== null && used >= plan.monthlyExportLimit)
      throw new ApiError(403, 'export_limit', `Has usado tus ${plan.monthlyExportLimit} exportaciones de este mes`);
    if (format === 'fbx' || format === '3mf')
      throw new ApiError(501, 'server_conversion', 'Este formato se convierte en el servidor y llega con el backend');
    const blob = await (await modelKit()).exportModel(await this.model(a), format);
    this.commit((s) => s.exports.push(now()));
    const safe = a.name.toLowerCase().replace(/[^a-z0-9áéíóúñü]+/gi, '-').replace(/^-|-$/g, '') || 'modelo';
    return { url: URL.createObjectURL(blob), filename: `${safe}.${format}` };
  }

  // ------------------------------------------------------------------ pagos
  async checkout(planId: string, interval: 'month' | 'year'): Promise<void> {
    this.requireUser();
    const plan = PLANS.find((p) => p.id === planId);
    if (!plan) throw new ApiError(404, 'not_found', 'Ese plan no existe');
    await sleep(700);
    this.commit((s) => {
      // como invoice.paid: lo no gastado se arrastra (máx. lo concedido el mes anterior) y se concede el plan nuevo
      const prev = PLANS.find((p) => p.id === s.planId)?.monthlyCredits ?? 0;
      const carry = Math.min(s.credits.monthly, prev);
      if (s.credits.monthly > carry) {
        this.ledgerAdd(s, { delta: carry - s.credits.monthly, bucket: 'monthly', reason: 'expire', note: 'Fin del ciclo (más de un mes sin usar)' });
      }
      s.planId = plan.id;
      s.credits.monthly = plan.monthlyCredits + carry;
      s.credits.cycleEndsAt = (interval === 'year'
        ? new Date(Date.now() + 30 * 86400000) : nextCycle()).toISOString();
      this.ledgerAdd(s, { delta: plan.monthlyCredits, bucket: 'monthly', reason: 'grant',
        note: `Plan ${plan.name} (${interval === 'year' ? 'anual' : 'mensual'}) · pago simulado` });
      const h = plan.historyDays;
      for (const a of s.assets) a.expiresAt = h ? new Date(new Date(a.createdAt).getTime() + h * 86400000).toISOString() : null;
    });
  }

  async creditPacks(): Promise<CreditPack[]> {
    return PACKS;
  }

  async buyPack(packId: string): Promise<void> {
    this.requireUser();
    const pack = PACKS.find((p) => p.id === packId);
    if (!pack) throw new ApiError(404, 'not_found', 'Ese pack no está a la venta');
    await sleep(700);
    this.commit((s) => {
      const total = pack.credits + pack.bonusCredits;
      s.credits.permanent += total;
      this.ledgerAdd(s, { delta: total, bucket: 'permanent', reason: 'purchase', note: `Pack de ${pack.credits} créditos · pago simulado` });
    });
  }

  async deleteAccount(): Promise<void> {
    for (const url of this.glbUrls.values()) URL.revokeObjectURL(url);
    this.glbUrls.clear();
    this.models.clear();
    this.state$.next(empty());
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      /* nada que borrar */
    }
  }
}
