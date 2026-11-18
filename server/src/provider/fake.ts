import { Document, NodeIO } from '@gltf-transform/core';
import type { GenerationInput, GenerationOutput, GenerationProvider } from './provider.js';
import { ProviderError } from './provider.js';

// Proveedor falso: construye un objeto procedural (vasija de revolución) como GLB.
// Sirve para desarrollar y probar todo el sistema sin GPU. Un prompt o archivo con "fallo" falla al 30 %.

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** Superficie de revolución con `radial` x `rings` segmentos. */
export async function vesselGlb(seed: number, radial: number, rings: number, color: [number, number, number]): Promise<Buffer> {
  const r = rng(seed);
  const base = 0.35 + r() * 0.25, belly = 0.55 + r() * 0.35, neck = 0.15 + r() * 0.2, lip = neck + 0.05 + r() * 0.15;
  const profile: [number, number][] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const rad = t < 0.45 ? base + (belly - base) * Math.sin((t / 0.45) * Math.PI / 2)
      : t < 0.85 ? belly + (neck - belly) * ((t - 0.45) / 0.4)
      : neck + (lip - neck) * ((t - 0.85) / 0.15);
    profile.push([rad, t * 1.8 - 0.9]);
  }
  const pos: number[] = [], idx: number[] = [];
  for (const [rad, y] of profile) {
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(Math.cos(a) * rad, y, Math.sin(a) * rad);
    }
  }
  const row = radial + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * row + j, b = a + row;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const doc = new Document();
  const buffer = doc.createBuffer();
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buffer))
    .setMaterial(doc.createMaterial('superficie').setBaseColorFactor([...color, 1]).setRoughnessFactor(0.6).setMetallicFactor(0.1)
      .setDoubleSided(true));
  const mesh = doc.createMesh('modelo').addPrimitive(prim);
  doc.createScene().addChild(doc.createNode('modelo').setMesh(mesh));
  return Buffer.from(await new NodeIO().writeBinary(doc));
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), rej(new ProviderError('cancelada'))), { once: true });
  });

export class FakeProvider implements GenerationProvider {
  readonly name = 'fake';
  constructor(private readonly stepMs = 400) {}

  async generate(input: GenerationInput, onProgress: (pct: number) => Promise<void>, signal: AbortSignal): Promise<GenerationOutput> {
    const steps = input.series === 'hd' ? 20 : 10;
    const fails = /fallo/i.test(`${input.prompt ?? ''} ${input.image?.filename ?? ''}`);
    for (let i = 1; i <= steps; i++) {
      await sleep(this.stepMs, signal);
      const pct = Math.round((i / steps) * 95);
      if (fails && pct >= 30) throw new ProviderError('El motor no ha podido reconstruir este objeto');
      await onProgress(pct);
    }
    const hue = (hash(input.prompt ?? input.taskId) % 360) / 360;
    const color = input.params.texture ? hsl(hue, 0.45, 0.55) : ([0.72, 0.74, 0.77] as [number, number, number]);
    // caras ≈ 2 · radial · rings
    const faces = input.series === 'hd' ? 60000 : input.params.faceLimit;
    const rings = Math.max(8, Math.round(Math.sqrt(faces / 2 / 4)));
    const radial = Math.max(8, Math.round(faces / 2 / rings));
    const variants: Buffer[] = [];
    for (let v = 0; v < input.params.variants; v++) variants.push(await vesselGlb(hash(`${input.taskId}:${v}`), radial, rings, color));
    return { variants, modelVersion: 'fake-1' };
  }
}
