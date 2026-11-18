import { NodeIO } from '@gltf-transform/core';
import type { GenerationInput, GenerationOutput, GenerationProvider } from './provider.js';
import { ProviderError } from './provider.js';

/**
 * Motor 3D en fal.ai (API pública de cola, con la clave del usuario: FAL_KEY).
 *  - Imagen a 3D: TRELLIS.2 (`fal-ai/trellis-2`, pesos MIT de Microsoft).
 *  - Texto a 3D: FLUX.1 [schnell] (Apache 2.0) genera una imagen de referencia y después TRELLIS.2.
 * Precio orientativo (2026-11): $0,25 / 0,30 / 0,35 por modelo a 512 / 1024 / 1536. Ver backend.md.
 * Se sustituirá por un adaptador propio en Modal cuando el volumen lo justifique; la interfaz no cambia.
 */
export interface FalOptions {
  key: string;
  baseUrl?: string; // https://queue.fal.run (se cambia en los tests)
  model3d?: string;
  textToImage?: string;
  pollMs?: number;
  timeoutMs?: number;
  maxGlbBytes?: number;
  fetch?: typeof fetch;
}

interface QueueRef { request_id: string; status_url: string; response_url: string; cancel_url: string }
interface QueueStatus { status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED'; queue_position?: number; error?: string; error_type?: string }

const TEXTURE_SIZE = { '2k': 2048, '4k': 4096, '8k': 4096 } as const; // TRELLIS.2 llega a 4096

/** Frase añadida al prompt para que la imagen sirva como referencia de 3D. */
const REFERENCE_STYLE =
  'single object, centered, full view, plain white background, soft studio lighting, no text, no shadows, product shot';

export class FalProvider implements GenerationProvider {
  readonly name = 'fal';
  private readonly base: string;
  private readonly model3d: string;
  private readonly textToImage: string;
  private readonly pollMs: number;
  private readonly timeoutMs: number;
  private readonly maxGlb: number;
  private readonly http: typeof fetch;

  constructor(private readonly o: FalOptions) {
    this.base = (o.baseUrl ?? 'https://queue.fal.run').replace(/\/$/, '');
    this.model3d = o.model3d ?? 'fal-ai/trellis-2';
    this.textToImage = o.textToImage ?? 'fal-ai/flux/schnell';
    this.pollMs = o.pollMs ?? 1500;
    this.timeoutMs = o.timeoutMs ?? 10 * 60_000;
    this.maxGlb = o.maxGlbBytes ?? 300 * 1024 * 1024;
    this.http = o.fetch ?? fetch;
  }

  // ------------------------------------------------------------------ cola de fal

  private async call(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    let r: Response;
    try {
      r = await this.http(url, {
        ...init, signal,
        headers: { Authorization: `Key ${this.o.key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      });
    } catch (e) {
      if (signal?.aborted) throw new ProviderError('cancelada');
      throw new ProviderError('No hay conexión con el motor 3D', true);
    }
    if (r.status === 401 || r.status === 403) {
      // problema de la cuenta de fal (clave o saldo): el detalle es para quien opera la app, no para el usuario
      const detail = await r.text().catch(() => '');
      console.error(`[fal] ${r.status}: ${r.status === 401 ? 'clave rechazada: revisa FAL_KEY' : 'cuenta bloqueada o sin saldo: revisa fal.ai/dashboard/billing'} · ${detail.slice(0, 200)}`);
      throw new ProviderError('El motor 3D no está disponible ahora mismo. Te hemos devuelto los créditos');
    }
    if (r.status === 429 || r.status >= 500) throw new ProviderError('El motor 3D está saturado. Te hemos devuelto los créditos', true);
    return r;
  }

  /** Envía a la cola, espera y devuelve el resultado. Cancela en fal si se aborta. */
  private async run<T>(model: string, input: object, signal: AbortSignal, onState: (s: QueueStatus) => Promise<void>): Promise<T> {
    const sub = await this.call(`${this.base}/${model}`, { method: 'POST', body: JSON.stringify(input) }, signal);
    if (!sub.ok) throw await this.inputError(sub);
    const ref = (await sub.json()) as QueueRef;
    const started = Date.now();
    const cancel = () => void this.http(ref.cancel_url, { method: 'PUT', headers: { Authorization: `Key ${this.o.key}` } }).catch(() => {});
    signal.addEventListener('abort', cancel, { once: true });
    try {
      for (;;) {
        if (Date.now() - started > this.timeoutMs) {
          cancel();
          throw new ProviderError('El motor 3D ha tardado demasiado. Te hemos devuelto los créditos');
        }
        const st = (await (await this.call(ref.status_url, {}, signal)).json()) as QueueStatus;
        await onState(st);
        if (st.status === 'COMPLETED') {
          if (st.error) throw this.runError(st);
          const res = await this.call(ref.response_url, {}, signal);
          if (!res.ok) throw await this.inputError(res);
          return (await res.json()) as T;
        }
        await new Promise<void>((ok, ko) => {
          const t = setTimeout(ok, this.pollMs);
          signal.addEventListener('abort', () => (clearTimeout(t), ko(new ProviderError('cancelada'))), { once: true });
        });
      }
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }

  private async inputError(r: Response): Promise<ProviderError> {
    const body = await r.json().catch(() => ({})) as { detail?: unknown };
    // 422 de fal: la imagen o los parámetros no valen. Sin reintentos.
    console.error('[fal] petición rechazada', r.status, JSON.stringify(body.detail ?? body).slice(0, 300));
    return new ProviderError(r.status === 422
      ? 'El motor 3D no ha podido usar esta imagen. Prueba con otra con el objeto centrado y fondo liso'
      : 'El motor 3D ha rechazado la petición');
  }

  private runError(st: QueueStatus): ProviderError {
    console.error('[fal] fallo en la ejecución', st.error_type, (st.error ?? '').slice(0, 300));
    return new ProviderError('El motor no ha podido reconstruir este objeto. Te hemos devuelto los créditos', st.error_type === 'runner_server_error');
  }

  private async download(url: string, signal: AbortSignal, max: number): Promise<Buffer> {
    // solo se descarga de fal (o de la URL base en los tests): evita que una respuesta manipulada haga
    // que el servidor pida URLs internas o de terceros
    let ok = url.startsWith(this.base + '/');
    try {
      const u = new URL(url);
      ok ||= u.protocol === 'https:' && /(^|\.)fal\.(media|ai|run)$/.test(u.hostname);
    } catch {
      ok = false;
    }
    if (!ok) throw new ProviderError('El motor 3D ha devuelto un archivo no válido');
    const r = await this.http(url, { signal }).catch(() => null);
    if (!r?.ok) throw new ProviderError('No se ha podido descargar el modelo del motor 3D', true);
    const len = Number(r.headers.get('content-length') ?? 0);
    if (len > max) throw new ProviderError('El modelo generado es demasiado grande');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > max) throw new ProviderError('El modelo generado es demasiado grande');
    return buf;
  }

  // ------------------------------------------------------------------ generación

  async generate(input: GenerationInput, onProgress: (pct: number) => Promise<void>, signal: AbortSignal): Promise<GenerationOutput> {
    const p = input.params;
    let imageUrl: string;
    let pct = 2;
    const tick = async (to: number) => {
      pct = Math.max(pct, Math.min(to, 94));
      await onProgress(Math.round(pct));
    };

    if (input.type === 'text_to_model') {
      // 1) imagen de referencia (≈ 10 % del tiempo)
      const img = await this.run<{ images: { url: string }[]; has_nsfw_concepts?: boolean[] }>(this.textToImage, {
        prompt: `${input.prompt}. ${REFERENCE_STYLE}`, image_size: 'square_hd', num_images: 1,
        enable_safety_checker: true, output_format: 'png',
      }, signal, async (s) => tick(s.status === 'IN_PROGRESS' ? 8 : 4));
      if (img.has_nsfw_concepts?.[0]) throw new ProviderError('La descripción no está permitida. No se ha cobrado nada');
      if (!img.images?.[0]?.url) throw new ProviderError('No se ha podido crear la imagen de referencia');
      imageUrl = img.images[0].url;
      await tick(10);
    } else {
      if (!input.image) throw new ProviderError('Falta la imagen de entrada');
      // data URI: la imagen no tiene que ser pública ni salir de nuestro almacén con una URL
      imageUrl = `data:${input.image.contentType};base64,${input.image.bytes.toString('base64')}`;
    }

    // 2) TRELLIS.2, una petición por variante con semillas distintas
    const smart = input.series === 'smart';
    const base = {
      image_url: imageUrl,
      resolution: smart ? 1024 : 1024,
      texture_size: p.texture ? TEXTURE_SIZE[p.textureResolution] : 1024,
      remesh: true,
      // decimation_target cuenta vértices; una malla cerrada tiene ~2 caras por vértice
      decimation_target: smart ? Math.max(500, Math.round(p.faceLimit / 2)) : 500_000,
    };
    const n = Math.max(1, p.variants);
    const done = new Array<number>(n).fill(0);
    const glbs = await Promise.all(Array.from({ length: n }, async (_, i) => {
      const seed = hash(`${input.taskId}:${i}`) % 2_147_483_647;
      const startedAt = Date.now();
      const out = await this.run<{ model_glb?: { url: string } }>(this.model3d, { ...base, seed }, signal, async (s) => {
        // fal no da porcentaje: se estima con el tiempo típico (≈ 25 s en progreso)
        done[i] = s.status === 'IN_QUEUE' ? 0.05 : s.status === 'IN_PROGRESS' ? Math.min(0.9, 0.1 + (Date.now() - startedAt) / 30_000) : 0.95;
        await tick(10 + (done.reduce((a, b) => a + b, 0) / n) * 84);
      });
      if (!out.model_glb?.url) throw new ProviderError('El motor 3D no ha devuelto ningún modelo');
      let glb = await this.download(out.model_glb.url, signal, this.maxGlb);
      if (glb.subarray(0, 4).toString('ascii') !== 'glTF') throw new ProviderError('El motor 3D ha devuelto un archivo no válido');
      if (!p.texture) glb = await stripTextures(glb);
      return glb;
    }));
    return { variants: glbs, modelVersion: `fal:${this.model3d}` };
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** "Sin textura": quita imágenes y deja un gris neutro, para mallas que se texturizan después en otra herramienta. */
export async function stripTextures(glb: Buffer): Promise<Buffer> {
  const io = new NodeIO();
  const doc = await io.readBinary(new Uint8Array(glb));
  for (const m of doc.getRoot().listMaterials()) {
    m.setBaseColorTexture(null).setMetallicRoughnessTexture(null).setNormalTexture(null)
      .setOcclusionTexture(null).setEmissiveTexture(null)
      .setBaseColorFactor([0.72, 0.74, 0.77, 1]).setMetallicFactor(0).setRoughnessFactor(0.7);
  }
  for (const t of doc.getRoot().listTextures()) t.dispose();
  return Buffer.from(await io.writeBinary(doc));
}
