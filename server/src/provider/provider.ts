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
  /**
   * Vista previa antes de pagar: solo la imagen de referencia de un texto (el primer paso de texto a 3D).
   * Cuesta céntimos de céntimo; el modelo 3D se genera después a partir de esta imagen si el usuario la aprueba.
   */
  referenceImage(prompt: string, signal: AbortSignal): Promise<{ bytes: Buffer; contentType: 'image/png' }>;

  /**
   * Separa el modelo en piezas con sentido (orejas, cabeza…). Devuelve un GLB con una malla por pieza, para poder
   * colorear cada una por separado. Cuesta unos céntimos por modelo (motor real); el falso lo aproxima sin coste.
   */
  segment(glb: Buffer, signal: AbortSignal): Promise<{ glb: Buffer; parts: number }>;
}
