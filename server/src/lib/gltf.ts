import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

/**
 * Lector/escritor de glTF con todas las extensiones registradas (BUG-009). Los motores devuelven GLB con extensiones
 * obligatorias como EXT_texture_webp; sin registrarlas, leerlos falla. Draco y meshopt quedan fuera (no se usan).
 */
let io: NodeIO | null = null;
export function gltfIO(): NodeIO {
  io ??= new NodeIO().registerExtensions(ALL_EXTENSIONS);
  return io;
}
