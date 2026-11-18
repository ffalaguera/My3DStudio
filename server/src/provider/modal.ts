import type { GenerationInput, GenerationOutput, GenerationProvider } from './provider.js';
import { ProviderError } from './provider.js';
import { stripTextures } from './fal.js';

/**
 * Motor 3D propio desplegado en Modal (gpu/trellis_service.py): TRELLIS.2 en su versión comercial
 * (BiRefNet + cuBVH, con auditoría de licencias) y FLUX.1 [schnell] para texto → imagen.
 * Coste: segundos de GPU de tu cuenta de Modal (el plan gratuito incluye $30 al mes).
 */
export interface ModalOptions {
  url: string; // https://<tu-usuario>--forma-trellis-api.modal.run
  token: string; // SERVICE_TOKEN del secreto "forma-trellis"
  pollMs?: number;
  timeoutMs?: number;
  maxFileBytes?: number;
  fetch?: typeof fetch;
}

interface JobStatus { status: 'running' | 'done' | 'failed'; progress?: number; count?: number; error?: string }

const TEXTURE_SIZE = { '2k': 2048, '4k': 4096, '8k': 4096 } as const;
const REFERENCE_STYLE =
  'single object, centered, full view, plain white background, soft studio lighting, no text, no shadows, product shot';

export class ModalProvider implements GenerationProvider {
  readonly name = 'modal';
  private readonly url: string;
  private readonly pollMs: number;
  private readonly timeoutMs: number;
  private readonly maxFile: number;
  private readonly http: typeof fetch;

  constructor(private readonly o: ModalOptions) {
    this.url = o.url.replace(/\/$/, '');
    this.pollMs = o.pollMs ?? 2000;
    this.timeoutMs = o.timeoutMs ?? 15 * 60_000; // incluye un posible arranque en frío (carga de pesos)
    this.maxFile = o.maxFileBytes ?? 300 * 1024 * 1024;
    this.http = o.fetch ?? fetch;
  }

  private async call(path: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    let r: Response;
    try {
      r = await this.http(`${this.url}${path}`, {
        ...init, signal, headers: { Authorization: `Bearer ${this.o.token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      });
    } catch {
      if (signal.aborted) throw new ProviderError('cancelada');
      throw new ProviderError('No hay conexión con el motor 3D', true);
    }
    if (r.status === 401) throw new ProviderError('El motor 3D rechaza el token (MODAL_SERVICE_TOKEN)');
    if (r.status === 429 || r.status >= 500) throw new ProviderError('El motor 3D está saturado. Te hemos devuelto los créditos', true);
    return r;
  }

  /** Crea el trabajo, espera con sondeo y devuelve los archivos. Cancela en Modal si se aborta. */
  private async job(body: object, signal: AbortSignal, onProgress: (p: number) => Promise<void>): Promise<Buffer[]> {
    const created = await this.call('/jobs', { method: 'POST', body: JSON.stringify(body) }, signal);
    if (!created.ok) {
      console.error('[modal] trabajo rechazado', created.status, (await created.text().catch(() => '')).slice(0, 300));
      throw new ProviderError(created.status === 422 ? 'El motor 3D no acepta estos datos' : 'El motor 3D ha rechazado la petición');
    }
    const { id } = (await created.json()) as { id: string };
    const cancel = () => void this.http(`${this.url}/jobs/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${this.o.token}` },
    }).catch(() => {});
    signal.addEventListener('abort', cancel, { once: true });
    const started = Date.now();
    try {
      for (;;) {
        if (Date.now() - started > this.timeoutMs) {
          cancel();
          throw new ProviderError('El motor 3D ha tardado demasiado. Te hemos devuelto los créditos');
        }
        const st = (await (await this.call(`/jobs/${encodeURIComponent(id)}`, { method: 'GET' }, signal)).json()) as JobStatus;
        if (st.status === 'failed') {
          console.error('[modal] fallo en la ejecución', (st.error ?? '').slice(0, 300));
          // la auditoría de licencias no limpia es un error de configuración, no del usuario
          throw new ProviderError('El motor no ha podido reconstruir este objeto. Te hemos devuelto los créditos');
        }
        await onProgress(st.progress ?? 0);
        if (st.status === 'done') {
          const files: Buffer[] = [];
          for (let i = 0; i < (st.count ?? 0); i++) {
            const r = await this.call(`/jobs/${encodeURIComponent(id)}/file/${i}`, { method: 'GET' }, signal);
            if (!r.ok) throw new ProviderError('No se ha podido descargar el resultado del motor 3D', true);
            const buf = Buffer.from(await r.arrayBuffer());
            if (buf.length > this.maxFile) throw new ProviderError('El modelo generado es demasiado grande');
            files.push(buf);
          }
          if (!files.length) throw new ProviderError('El motor 3D no ha devuelto ningún archivo');
          return files;
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

  async generate(input: GenerationInput, onProgress: (pct: number) => Promise<void>, signal: AbortSignal): Promise<GenerationOutput> {
    const p = input.params;
    let pct = 2;
    const report = async (to: number) => {
      pct = Math.max(pct, Math.min(94, to));
      await onProgress(Math.round(pct));
    };

    let png: Buffer;
    if (input.type === 'text_to_model') {
      const [img] = await this.job(
        { kind: 'image', prompt: `${input.prompt}. ${REFERENCE_STYLE}`, seed: hash(input.taskId) % 2_147_483_647 },
        signal, async (f) => report(2 + f * 8));
      if (img.subarray(1, 4).toString('ascii') !== 'PNG') throw new ProviderError('No se ha podido crear la imagen de referencia');
      png = img;
    } else {
      if (!input.image) throw new ProviderError('Falta la imagen de entrada');
      png = input.image.bytes;
    }

    const seeds = Array.from({ length: Math.max(1, p.variants) }, (_, i) => hash(`${input.taskId}:${i}`) % 2_147_483_647);
    const glbs = await this.job({
      kind: 'model',
      image_b64: png.toString('base64'),
      seeds,
      resolution: 1024,
      // aquí la decimación cuenta caras (to_glb del fork); alto detalle ≈ 1 M de caras
      decimation: input.series === 'smart' ? Math.max(500, p.faceLimit) : 1_000_000,
      texture_size: p.texture ? TEXTURE_SIZE[p.textureResolution] : 1024,
    }, signal, async (f) => report(10 + f * 84));

    const out: Buffer[] = [];
    for (const g of glbs) {
      if (g.subarray(0, 4).toString('ascii') !== 'glTF') throw new ProviderError('El motor 3D ha devuelto un archivo no válido');
      out.push(p.texture ? g : await stripTextures(g));
    }
    return { variants: out, modelVersion: 'trellis2-4b@modal' };
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
