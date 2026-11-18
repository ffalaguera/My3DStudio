/** Interfaz del motor 3D (architecture.md). Un adaptador por proveedor; el elegido va en GENERATION_PROVIDER. */
export interface GenerationInput {
  taskId: string;
  type: 'image_to_model' | 'text_to_model';
  series: 'hd' | 'smart';
  prompt?: string;
  texturePrompt?: string;
  image?: { bytes: Buffer; contentType: string; filename?: string };
  params: {
    texture: boolean;
    textureResolution: '2k' | '4k' | '8k';
    pbr: boolean;
    topology: 'tri' | 'quad';
    faceLimit: number;
    variants: number;
  };
}

export interface GenerationOutput {
  /** Un GLB por variante. */
  variants: Buffer[];
  modelVersion: string;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export interface GenerationProvider {
  readonly name: string;
  generate(input: GenerationInput, onProgress: (pct: number) => Promise<void>, signal: AbortSignal): Promise<GenerationOutput>;
}
