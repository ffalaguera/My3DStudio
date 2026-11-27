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
  /** Tienda: generaciones gratis de hoy (perDay null = sin tope). null en el modelo de créditos. */
  generations?: { perDay: number | null; today: number } | null;
  /** Acceso al panel del taller (pedidos y archivos para imprimir). */
  isAdmin?: boolean;
}

// ------------------------------------------------------------------ tienda de figuras impresas
export type SizeId = 's' | 'm' | 'l';
export interface ShopSize { id: SizeId; name: string; heightMm: number; priceCents: number }
export interface ShopColor { id: string; name: string; hex: string }
export interface Catalog {
  sizes: ShopSize[];
  colors: ShopColor[];
  shippingCents: number;
  currency: string;
  maxQuantity: number;
  deliveryDays: { min: number; max: number };
  /** Sin Stripe en desarrollo: el pago se simula en la página del pedido. */
  demoPayments: boolean;
}
export type OrderStatus = 'pending_payment' | 'paid' | 'printing' | 'shipped' | 'cancelled' | 'refunded';
export interface Order {
  id: string;
  assetId: string | null;
  assetName: string;
  size: SizeId;
  heightMm: number;
  color: string;
  base: boolean;
  quantity: number;
  unitCents: number;
  shippingCents: number;
  totalCents: number;
  currency: string;
  status: OrderStatus;
  tracking: string | null;
  shipping: { name?: string; address?: { line1?: string; line2?: string; city?: string; postal_code?: string; country?: string } } | null;
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  /** Solo en el panel del taller. */
  email?: string | null;
  note?: string | null;
}
export interface OrderRequest { assetId: string; size: SizeId; color: string; base: boolean; quantity: number }

export interface Upload {
  id: string;
  previewUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface PrintOptions { heightMm: number; base: boolean }
export interface PrintReport {
  heightMm: number;
  base: boolean;
  sizeMm: { x: number; y: number; z: number };
  triangles: number;
  watertight: boolean;
  openEdges: number;
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
  /** shop: generar gratis y vender figuras impresas (sin descargas). credits: el modelo anterior. */
  businessModel: 'shop' | 'credits';
}

/** Pack de créditos sin caducidad (pago único). */
export interface CreditPack {
  id: string;
  credits: number;
  bonusCredits: number;
  priceCents: number;
  currency: string;
  purchasable: boolean;
}

export abstract class Api {
  abstract capabilities(): Promise<Capabilities>;

  // Sesión (Supabase Auth en el backend real)
  abstract session(): Observable<Profile | null>;
  /** Con enlace por email puede lanzar ApiError('check_email'): el acceso termina al abrir el enlace. */
  abstract signIn(method: 'google' | 'email', email?: string): Promise<Profile>;
  abstract signOut(): Promise<void>;
  /** Acceso propio: canjea el token del enlace del email (/entrar). Devuelve la ruta a la que volver. */
  abstract completeEmailSignIn(token: string): Promise<string>;

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
  /** STL y 3MF admiten `print`: altura final en mm y peana. Entonces vuelve también el informe de impresión. */
  abstract exportAsset(id: string, format: ExportFormat, print?: PrintOptions): Promise<{ url: string; filename: string; print?: PrintReport }>;
  /** Separa el modelo en piezas y devuelve un GLB con una malla por pieza. */
  abstract segmentAsset(id: string): Promise<{ url: string; parts: number | null }>;
  /** Vista previa antes de pagar: la imagen de referencia de un texto, sin gastar créditos. */
  abstract previewImage(prompt: string): Promise<Upload>;

  // Tienda: GET /shop/catalog, POST /orders (→ URL de pago), GET /orders(/:id), POST /orders/:id/demo-pay
  abstract catalog(): Promise<Catalog>;
  abstract createOrder(req: OrderRequest): Promise<{ order: Order; url: string }>;
  abstract orders(): Promise<Order[]>;
  abstract order(id: string): Promise<Order>;
  abstract demoPay(id: string): Promise<Order>;
  // Panel del taller: GET /admin/orders, PATCH /admin/orders/:id, POST /admin/orders/:id/file
  abstract adminOrders(status: 'open' | 'all' | OrderStatus): Promise<Order[]>;
  abstract adminUpdateOrder(id: string, patch: { status?: 'printing' | 'shipped' | 'cancelled'; tracking?: string; note?: string }): Promise<Order>;
  abstract adminOrderFile(id: string, format: 'stl' | '3mf'): Promise<{ url: string; filename: string; print: PrintReport }>;

  // /billing (Stripe Checkout en el real)
  abstract checkout(planId: string, interval: 'month' | 'year'): Promise<void>;
  abstract creditPacks(): Promise<CreditPack[]>;
  /** Pago único de un pack: los créditos se suman a la bolsa permanente y no caducan. */
  abstract buyPack(packId: string): Promise<void>;
  /** Customer Portal de Stripe: cambiar tarjeta, plan o cancelar en un clic. */
  abstract billingPortal(): Promise<void>;
  abstract deleteAccount(): Promise<void>;
}
