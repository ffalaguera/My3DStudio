import { Document } from '@gltf-transform/core';
import { gltfIO } from './gltf.js';

/**
 * Separación de piezas «de mentira» para el motor de demostración (sin coste): parte el modelo en `k` trozos
 * por cercanía espacial (Voronoi sobre los centros de las caras). No son piezas con sentido anatómico como las
 * que da el motor real, pero producen un GLB con varias mallas (una por pieza) para probar el flujo de pintar
 * por piezas sin gastar. Cada pieza sale de un color para que se distingan.
 */
export async function splitIntoParts(glb: Buffer, k = 8): Promise<{ glb: Buffer; parts: number }> {
  const io = gltfIO();
  const src = await io.readBinary(new Uint8Array(glb));

  // Soup de triángulos: posiciones globales y caras (3 índices por cara).
  const positions: number[] = [];
  const faces: [number, number, number][] = [];
  for (const mesh of src.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const posAcc = prim.getAttribute('POSITION');
      const idxAcc = prim.getIndices();
      if (!posAcc) continue;
      const base = positions.length / 3;
      const pa = posAcc.getArray()!;
      for (let i = 0; i < pa.length; i++) positions.push(pa[i]);
      if (idxAcc) {
        const ia = idxAcc.getArray()!;
        for (let i = 0; i + 2 < ia.length; i += 3) faces.push([base + ia[i], base + ia[i + 1], base + ia[i + 2]]);
      } else {
        const n = pa.length / 3;
        for (let i = 0; i + 2 < n; i += 3) faces.push([base + i, base + i + 1, base + i + 2]);
      }
    }
  }
  if (!faces.length) return { glb, parts: 1 };
  k = Math.max(2, Math.min(k, 16, Math.floor(faces.length / 50) || 2));

  // Centro de cada cara.
  const cx = new Float32Array(faces.length), cy = new Float32Array(faces.length), cz = new Float32Array(faces.length);
  for (let f = 0; f < faces.length; f++) {
    const [a, b, c] = faces[f];
    cx[f] = (positions[a * 3] + positions[b * 3] + positions[c * 3]) / 3;
    cy[f] = (positions[a * 3 + 1] + positions[b * 3 + 1] + positions[c * 3 + 1]) / 3;
    cz[f] = (positions[a * 3 + 2] + positions[b * 3 + 2] + positions[c * 3 + 2]) / 3;
  }
  // Semillas por muestreo del punto más lejano (reparte las piezas por todo el modelo).
  const seeds = [0];
  const d2 = (f: number, s: number) => (cx[f] - cx[s]) ** 2 + (cy[f] - cy[s]) ** 2 + (cz[f] - cz[s]) ** 2;
  const best = new Float32Array(faces.length).fill(Infinity);
  while (seeds.length < k) {
    const last = seeds[seeds.length - 1];
    let far = 0, farD = -1;
    for (let f = 0; f < faces.length; f++) {
      best[f] = Math.min(best[f], d2(f, last));
      if (best[f] > farD) { farD = best[f]; far = f; }
    }
    if (farD <= 0) break;
    seeds.push(far);
  }
  // Cada cara a su semilla más cercana.
  const label = new Uint8Array(faces.length);
  for (let f = 0; f < faces.length; f++) {
    let bi = 0, bd = Infinity;
    for (let s = 0; s < seeds.length; s++) { const d = d2(f, seeds[s]); if (d < bd) { bd = d; bi = s; } }
    label[f] = bi;
  }

  // GLB de salida: una malla con una primitiva por pieza, cada una de un color.
  const doc = new Document();
  const buffer = doc.createBuffer();
  const mesh = doc.createMesh('piezas');
  const hsl = (h: number): [number, number, number] => {
    const a = 0.5 * Math.min(0.6, 0.4);
    const f = (n: number) => { const kk = (n + h * 12) % 12; return 0.6 - a * Math.max(-1, Math.min(kk - 3, 9 - kk, 1)); };
    return [f(0), f(8), f(4)];
  };
  let used = 0;
  for (let s = 0; s < seeds.length; s++) {
    const map = new Map<number, number>();
    const pos: number[] = [], idx: number[] = [];
    for (let f = 0; f < faces.length; f++) {
      if (label[f] !== s) continue;
      for (const vi of faces[f]) {
        let m = map.get(vi);
        if (m === undefined) { m = pos.length / 3; map.set(vi, m); pos.push(positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]); }
        idx.push(m);
      }
    }
    if (!idx.length) continue;
    used++;
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buffer))
      .setMaterial(doc.createMaterial(`pieza-${s}`).setBaseColorFactor([...hsl(s / seeds.length), 1]).setMetallicFactor(0).setRoughnessFactor(0.7));
    mesh.addPrimitive(prim);
  }
  doc.createScene().addChild(doc.createNode('piezas').setMesh(mesh));
  return { glb: Buffer.from(await io.writeBinary(doc)), parts: used };
}
