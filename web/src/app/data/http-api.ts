import { Injectable, OnDestroy, inject } from '@angular/core';
import { BehaviorSubject, Observable, Subject, distinctUntilChanged, filter, from, map, merge, startWith, switchMap } from 'rxjs';
import {
  Api, ApiError, Asset, AssetFilter, Capabilities, CreateTaskRequest, Estimate, ExportFormat, LedgerEntry, Me,
  CreditPack, PlanLimits, Privacy, Profile, Task, Upload,
} from './api';
import { LocalAuth, SelfAuth, SupabaseAuth, type AuthClient } from './auth-client';
import { RUNTIME_CONFIG } from './runtime-config';

const MAX_IMAGE = 20 * 1024 * 1024;

/** Api contra el servidor Express (server/). Mismas firmas que FakeApi: ninguna pantalla cambia. */
@Injectable()
export class HttpApi extends Api implements OnDestroy {
  private readonly cfg = inject(RUNTIME_CONFIG);
  private readonly base = this.cfg.apiUrl!.replace(/\/$/, '');
  private readonly auth: AuthClient = this.cfg.auth === 'supabase' ? new SupabaseAuth(this.cfg)
    : this.cfg.auth === 'self' ? new SelfAuth(this.base, this.cfg.googleClientId) : new LocalAuth(this.base);

  private readonly me$ = new BehaviorSubject<Me | null>(null);
  private readonly tasks$ = new BehaviorSubject<Task[]>([]);
  private readonly assetsChanged$ = new Subject<void>();
  private sse: AbortController | null = null;
  private caps: Promise<Capabilities> | null = null;
  private readonly sub = this.auth.user$.pipe(distinctUntilChanged((a, b) => a?.id === b?.id)).subscribe((u) => {
    this.sse?.abort();
    this.sse = null;
    if (!u) {
      this.me$.next(null);
      this.tasks$.next([]);
      return;
    }
    void this.refreshMe();
    void this.refreshTasks();
    this.openEvents();
  });

  ngOnDestroy(): void {
    this.sub.unsubscribe();
    this.sse?.abort();
  }

  // ------------------------------------------------------------------ transporte
  private async req<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const token = await this.auth.token();
    let r: Response;
    try {
      r = await fetch(`${this.base}/api${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'network', 'Sin conexión con el servidor. Comprueba tu red');
    }
    if (r.status === 204) return undefined as T;
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401 && token) void this.auth.signOut();
      throw new ApiError(r.status, data.error?.code ?? 'error', data.error?.message ?? 'Algo ha fallado');
    }
    return data as T;
  }

  private async refreshMe(): Promise<void> {
    try {
      this.me$.next(await this.req<Me>('GET', '/me'));
    } catch {
      /* el siguiente cambio lo reintenta */
    }
  }

  private async refreshTasks(): Promise<void> {
    try {
      this.tasks$.next((await this.req<{ tasks: Task[] }>('GET', '/tasks')).tasks);
    } catch {
      /* idem */
    }
  }

  private upsertTask(t: Task): void {
    const list = this.tasks$.value;
    const i = list.findIndex((x) => x.id === t.id);
    const prev = i >= 0 ? list[i] : null;
    this.tasks$.next(i >= 0 ? list.map((x) => (x.id === t.id ? t : x)) : [t, ...list]);
    if (prev?.status !== t.status) {
      void this.refreshMe(); // créditos congelados, consumidos o devueltos
      if (t.status === 'success') this.assetsChanged$.next();
    }
  }

  /** SSE leído con fetch (EventSource no permite la cabecera Authorization). Reconecta solo. */
  private openEvents(): void {
    const ac = new AbortController();
    this.sse = ac;
    const loop = async (delay: number) => {
      while (!ac.signal.aborted) {
        try {
          const token = await this.auth.token();
          const r = await fetch(`${this.base}/api/events`, { headers: { Authorization: `Bearer ${token}` }, signal: ac.signal });
          if (!r.ok || !r.body) throw new Error(String(r.status));
          delay = 1000;
          await this.refreshTasks(); // lo que haya cambiado mientras no había conexión
          const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
          let buf = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += value;
            let k: number;
            while ((k = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, k);
              buf = buf.slice(k + 2);
              const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
              if (block.includes('event: task') && data) this.upsertTask(JSON.parse(data) as Task);
            }
          }
        } catch {
          if (ac.signal.aborted) return;
        }
        await new Promise((res) => setTimeout(res, delay));
        delay = Math.min(delay * 2, 15000);
      }
    };
    void loop(1000);
  }

  // ------------------------------------------------------------------ Api
  capabilities(): Promise<Capabilities> {
    this.caps ??= this.req<{ exportFormats: ExportFormat[]; billing: boolean }>('GET', '/capabilities')
      .then((c) => ({ exportFormats: c.exportFormats, billing: c.billing ? 'stripe' : 'off' }) as Capabilities)
      .catch(() => ({ exportFormats: ['glb'], billing: 'off' }) as Capabilities);
    return this.caps;
  }

  session(): Observable<Profile | null> {
    return this.auth.user$.asObservable();
  }

  signIn(method: 'google' | 'email', email?: string): Promise<Profile> {
    return this.auth.signIn(method, email);
  }

  async completeEmailSignIn(token: string): Promise<string> {
    if (!(this.auth instanceof SelfAuth)) throw new ApiError(400, 'auth_error', 'Este enlace no es válido aquí');
    return this.auth.completeEmailSignIn(token);
  }

  signOut(): Promise<void> {
    return this.auth.signOut();
  }

  me(): Observable<Me | null> {
    return this.me$.asObservable();
  }

  async plans(): Promise<PlanLimits[]> {
    return (await this.req<{ plans: PlanLimits[] }>('GET', '/plans')).plans;
  }

  async ledger(): Promise<LedgerEntry[]> {
    return (await this.req<{ entries: LedgerEntry[] }>('GET', '/credits/ledger')).entries;
  }

  async upload(file: File): Promise<Upload> {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new ApiError(415, 'unsupported_type', 'Formato no admitido. Usa JPG, PNG o WEBP');
    }
    if (file.size > MAX_IMAGE) throw new ApiError(413, 'too_large', `La imagen pesa ${Math.round(file.size / 1048576)} MB. El máximo es 20 MB`);
    const u = await this.req<{ uploadId: string; putUrl: string; headers: Record<string, string> }>('POST', '/uploads', {
      kind: 'image', contentType: file.type, sizeBytes: file.size, filename: file.name.slice(0, 200),
    });
    const put = await fetch(u.putUrl, { method: 'PUT', headers: u.headers, body: file }).catch(() => null);
    if (!put?.ok) throw new ApiError(put?.status ?? 0, 'upload_failed', 'No se ha podido subir la imagen. Inténtalo de nuevo');
    return (await this.req<{ upload: Upload }>('POST', `/uploads/${u.uploadId}/complete`)).upload;
  }

  estimate(req: Omit<CreateTaskRequest, 'idempotencyKey'>): Promise<Estimate> {
    if (!this.auth.user$.value) {
      // sin sesión se estima con la tarifa pública (replica/launch/pricing.md); con sesión la calcula el servidor
      const tex = req.params.texture ? { '2k': 0, '4k': 10, '8k': 20 }[req.params.textureResolution] : 0;
      const credits = req.series === 'smart' ? 50 * req.params.variants : 50 + tex;
      return Promise.resolve({ credits, etaSeconds: 0, allowed: false, reason: 'not_signed_in' });
    }
    return this.req<Estimate>('POST', '/tasks/estimate', this.body(req));
  }

  private body(req: Omit<CreateTaskRequest, 'idempotencyKey'>) {
    const { idempotencyKey, ...rest } = req as CreateTaskRequest;
    void idempotencyKey;
    return { ...rest, prompt: rest.prompt?.trim() || undefined, texturePrompt: rest.texturePrompt?.trim() || undefined };
  }

  async createTask(req: CreateTaskRequest): Promise<Task> {
    const { task } = await this.req<{ task: Task }>('POST', '/tasks', this.body(req), { 'Idempotency-Key': req.idempotencyKey });
    this.upsertTask(task);
    return task;
  }

  tasks(): Observable<Task[]> {
    return this.tasks$.asObservable();
  }

  taskEvents(id: string): Observable<Task> {
    return this.tasks$.pipe(
      map((l) => l.find((t) => t.id === id)),
      filter((t): t is Task => !!t),
      distinctUntilChanged((a, b) => a.status === b.status && a.progress === b.progress && a.queuePosition === b.queuePosition),
    );
  }

  async cancelTask(id: string): Promise<Task> {
    const { task } = await this.req<{ task: Task }>('DELETE', `/tasks/${id}`);
    this.upsertTask(task);
    return task;
  }

  async retryTask(id: string, idempotencyKey: string): Promise<Task> {
    const { task } = await this.req<{ task: Task }>('POST', `/tasks/${id}/retry`, undefined, { 'Idempotency-Key': idempotencyKey });
    this.upsertTask(task);
    return task;
  }

  assets(f: AssetFilter = {}): Observable<Asset[]> {
    const q = new URLSearchParams();
    if (f.q?.trim()) q.set('q', f.q.trim());
    if (f.series) q.set('series', f.series);
    if (f.hasTexture !== undefined) q.set('hasTexture', String(f.hasTexture));
    const path = `/assets${q.size ? `?${q}` : ''}`;
    return merge(this.assetsChanged$, this.auth.user$.pipe(distinctUntilChanged((a, b) => a?.id === b?.id))).pipe(
      startWith(null),
      switchMap(() => (this.auth.user$.value
        ? from(this.req<{ assets: Asset[] }>('GET', path).then((r) => r.assets, () => [] as Asset[]))
        : from(Promise.resolve([] as Asset[])))),
    );
  }

  async asset(id: string): Promise<Asset> {
    return (await this.req<{ asset: Asset }>('GET', `/assets/${id}`)).asset;
  }

  async updateAsset(id: string, patch: { name?: string; privacy?: Privacy }): Promise<Asset> {
    const { asset } = await this.req<{ asset: Asset }>('PATCH', `/assets/${id}`, patch);
    this.assetsChanged$.next();
    return asset;
  }

  async deleteAsset(id: string): Promise<void> {
    await this.req('DELETE', `/assets/${id}`);
    this.assetsChanged$.next();
    void this.refreshMe();
  }

  async exportAsset(id: string, format: ExportFormat): Promise<{ url: string; filename: string }> {
    const r = await this.req<{ url: string; filename: string }>('POST', `/assets/${id}/export`, { format });
    void this.refreshMe();
    return r;
  }

  async checkout(planId: string, interval: 'month' | 'year'): Promise<void> {
    const { url } = await this.req<{ url: string }>('POST', '/billing/checkout', { planId, interval });
    location.assign(url); // Stripe Checkout; vuelve a /cuenta?pago=ok
  }

  async creditPacks(): Promise<CreditPack[]> {
    return (await this.req<{ packs: CreditPack[] }>('GET', '/credit-packs')).packs;
  }

  async buyPack(packId: string): Promise<void> {
    const { url } = await this.req<{ url: string }>('POST', '/billing/pack', { packId });
    location.assign(url); // Stripe Checkout (pago único); vuelve a /cuenta?pack=ok
  }

  async billingPortal(): Promise<void> {
    const { url } = await this.req<{ url: string }>('POST', '/billing/portal', {});
    location.assign(url);
  }

  async deleteAccount(): Promise<void> {
    await this.req('DELETE', '/me', { confirm: 'BORRAR' });
    await this.auth.signOut();
  }
}
