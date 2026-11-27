import * as THREE from 'three';

/**
 * El motor 3D (TRELLIS) devuelve los materiales marcados como metálicos (metalness = 1). Un metal sin entorno
 * que reflejar se ve casi negro y, aunque haya entorno, oculta el color base de la figura. Como las figuras se
 * imprimen en un color mate, se neutraliza el metalizado al cargar para que se vea el color de verdad.
 */
export function neutralizeMetalness(model: THREE.Object3D): void {
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const s = mat as THREE.MeshStandardMaterial;
      if (s?.isMeshStandardMaterial && s.metalness > 0) {
        s.metalness = 0;
        s.needsUpdate = true;
      }
    }
  });
}
