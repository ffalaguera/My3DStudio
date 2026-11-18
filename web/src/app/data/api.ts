import { Observable } from 'rxjs';

// Tipos y firmas de la API de replica/architecture.md. Las pantallas solo dependen de esto.
// FakeApi (fake-api.ts) lo implementa en el navegador; HttpApi lo hará contra Express en /replica-backend.

export type Series = 'hd' | 'smart';
export type TaskType = 'image_to_model' | 'text_to_model';
export type TaskStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
export type Privacy = 'public' | 'private';
export type TextureResolution = '2k' | '4k' | '8k';
export type Topology = 'tri' | 'quad';
export type ExportFormat = 'glb' | 'obj' | 'stl' | 'usdz' | 'fbx' | '3mf';

export interface PlanLimits {
  id: string;
  name: string;
  priceMonthCents: number;
  priceYearCents: number;
  currency: string;
  monthlyCredits: number;
  maxConcurrentTasks: number;
  maxVariants: 1 | 2 | 4;
  monthlyExportLimit: number | null;
  maxSavedModels: number | null;
  historyDays: number | null;
  maxTextureResolution: TextureResolution;
  allowPrivate: boolean;
  allowCommercial: boolean;
  allowSmartMesh: boolean;
}

export interface Credits {
  monthly: number;
  permanent: number;
  frozen: number;
  available: number; // monthly + permanent
  cycleEndsAt: string;
}

export interface Profile {
  id: string;
  email: string;
  displayName: string;
}

export interface Me {
  profile: Profile;
  plan: PlanLimits;
  credits: Credits;
  usage: { exportsThisMonth: number; savedModels: number; activeTasks: number };
}

export interface Upload {
  id: string;
  previewUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface GenerationParams {
  textureResolution: TextureResolution;
  pbr: boolean;
  texture: boolean;
  topology: Topology;
  faceLimit: number;
  variants: 1 | 2 | 4;
}

export interface CreateTaskRequest {
  type: TaskType;
  series: Series;
  prompt?: string;
  texturePrompt?: string;
  uploadId?: string;
  params: GenerationParams;
  privacy: Privacy;
  idempotencyKey: string;
}

export interface Estimate {
  credits: number;
  etaSeconds: number;
  allowed: boolean;
  reason?: 'not_signed_in' | 'insufficient_credits' | 'plan_feature' | 'concurrency';
  detail?: string;
}

export interface Task {
  id: string;
  type: TaskType;
  series: Series;
  status: TaskStatus;
  progress: number;
  queuePosition: number | null;
  prompt?: string;
  inputPreviewUrl?: string;
  params: GenerationParams;
  creditsCost: number;
  assetIds: string[];
  errorMessage?: string;
  createdAt: string;
  finishedAt?: string;
}

export interface Asset {
  id: string;
  taskId: string | null;
  name: string;
  prompt?: string;
  series: Series;
  thumbnailUrl: string | null;
  glbUrl: string;
  faceCount: number;
  vertexCount: number;
  topology: Topology;
  textureResolution: TextureResolution | null;
  hasTexture: boolean;
  privacy: Privacy;
  license: 'attribution' | 'commercial';
  expiresAt: string | null;
  createdAt: string;
}

export interface AssetFilter {
  q?: string;
  series?: Series;
  hasTexture?: boolean;
}

export interface LedgerEntry {
  id: string;
  delta: number;
  bucket: 'monthly' | 'permanent';
  reason: 'grant' | 'purchase' | 'freeze' | 'consume' | 'release' | 'expire' | 'adjust';
  note: string;
  createdAt: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Capabilities {
  exportFormats: ExportFormat[];
  /** simulated = FakeApi; stripe = Checkout real; off = el servidor aún no tiene Stripe configurado */
  billing: 'simulated' | 'stripe' | 'off';
}

export abstract class Api {
  abstract capabilities(): Promise<Capabilities>;

  // Sesión (Supabase Auth en el backend real)
  abstract session(): Observable<Profile | null>;
  /** Con enlace por email puede lanzar ApiError('check_email'): el acceso termina al abrir el enlace. */
  abstract signIn(method: 'google' | 'email', email?: string): Promise<Profile>;
  abstract signOut(): Promise<void>;

  // GET /me, /plans, /credits/ledger
  abstract me(): Observable<Me | null>;
  abstract plans(): Promise<PlanLimits[]>;
  abstract ledger(): Promise<LedgerEntry[]>;

  // POST /uploads + PUT a R2 + POST /uploads/:id/complete
  abstract upload(file: File): Promise<Upload>;

  // POST /tasks/estimate, POST /tasks, GET /tasks/:id(/events), GET /tasks?status=active, DELETE, retry
  abstract estimate(req: Omit<CreateTaskRequest, 'idempotencyKey'>): Promise<Estimate>;
  abstract createTask(req: CreateTaskRequest): Promise<Task>;
  abstract tasks(): Observable<Task[]>;
  abstract taskEvents(id: string): Observable<Task>;
  abstract cancelTask(id: string): Promise<Task>;
  abstract retryTask(id: string, idempotencyKey: string): Promise<Task>;

  // /assets
  abstract assets(filter?: AssetFilter): Observable<Asset[]>;
  abstract asset(id: string): Promise<Asset>;
  abstract updateAsset(id: string, patch: { name?: string; privacy?: Privacy }): Promise<Asset>;
  abstract deleteAsset(id: string): Promise<void>;
  abstract exportAsset(id: string, format: ExportFormat): Promise<{ url: string; filename: string }>;

  // /billing (Stripe Checkout en el real)
  abstract checkout(planId: string, interval: 'month' | 'year'): Promise<void>;
  /** Customer Portal de Stripe: cambiar tarjeta, plan o cancelar en un clic. */
  abstract billingPortal(): Promise<void>;
  abstract deleteAccount(): Promise<void>;
}
