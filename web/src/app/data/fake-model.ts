import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import type { ExportFormat, Series } from './api';

// "Proveedor falso" de architecture.md: en vez de una GPU, construye un objeto procedural
// a partir de una semilla, para poder probar toda la app sin motor de IA.

export interface ModelSpec {
  seed: number;
  series: Series;
  color: string; // css hex
  faceLimit: number;
  texture: boolean;
}

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

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function material(spec: ModelSpec, r: () => number, tint = 0): THREE.MeshStandardMaterial {
  const c = new THREE.Color(spec.texture ? spec.color : '#b8bcc4');
  if (tint) c.offsetHSL(tint, 0, (r() - 0.5) * 0.1);
  return new THREE.MeshStandardMaterial({
    color: c,
    roughness: 0.35 + r() * 0.5,
    metalness: r() * 0.3,
    flatShading: spec.series === 'smart',
  });
}

/** Segmentos aproximados para quedar cerca del límite de caras pedido. */
function segmentsFor(spec: ModelSpec, parts: number): number {
  const perPart = Math.max(60, spec.faceLimit / parts);
  return Math.max(6, Math.min(spec.series === 'hd' ? 160 : 48, Math.round(Math.sqrt(perPart / 2))));
}

function vessel(spec: ModelSpec, r: () => number): THREE.Group {
  const g = new THREE.Group();
  const pts: THREE.Vector2[] = [];
  const base = 0.35 + r() * 0.25;
  const belly = 0.55 + r() * 0.35;
  const neck = 0.15 + r() * 0.2;
  const lip = neck + 0.05 + r() * 0.15;
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const radius =
      t < 0.45 ? THREE.MathUtils.lerp(base, belly, Math.sin((t / 0.45) * Math.PI * 0.5))
      : t < 0.85 ? THREE.MathUtils.lerp(belly, neck, (t - 0.45) / 0.4)
      : THREE.MathUtils.lerp(neck, lip, (t - 0.85) / 0.15);
    pts.push(new THREE.Vector2(radius, t * 1.8));
  }
  const s = segmentsFor(spec, 1);
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, s), material(spec, r));
  mesh.position.y = -0.9;
  g.add(mesh);
  return g;
}

function totem(spec: ModelSpec, r: () => number): THREE.Group {
  const g = new THREE.Group();
  const parts = 3 + Math.floor(r() * 3);
  const s = segmentsFor(spec, parts);
  let y = -1;
  for (let i = 0; i < parts; i++) {
    const h = 0.25 + r() * 0.35;
    const kind = Math.floor(r() * 3);
    const geo =
      kind === 0 ? new THREE.CylinderGeometry(0.3 + r() * 0.3, 0.35 + r() * 0.3, h, s, Math.max(1, s / 8))
      : kind === 1 ? new THREE.SphereGeometry(h * 0.9, s, Math.max(4, s / 2))
      : new THREE.TorusGeometry(0.35 + r() * 0.15, h * 0.3, Math.max(4, s / 3), s);
    const m = new THREE.Mesh(geo, material(spec, r, (r() - 0.5) * 0.15));
    m.position.y = y + h / 2;
    if (kind === 2) m.rotation.x = Math.PI / 2;
    g.add(m);
    y += h * (kind === 1 ? 1.6 : 1);
  }
  return g;
}

function crystal(spec: ModelSpec, r: () => number): THREE.Group {
  const g = new THREE.Group();
  // IcosahedronGeometry tiene 20·(detail+1)² caras
  const target = spec.series === 'hd' ? 60000 : spec.faceLimit;
  const detail = Math.max(1, Math.min(60, Math.round(Math.sqrt(target / 20) - 1)));
  const geo = new THREE.IcosahedronGeometry(0.9, detail);
  const pos = geo.attributes['position'] as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const k1 = 1 + r() * 3, k2 = 1 + r() * 3;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = 1 + 0.18 * Math.sin(v.x * k1 * 3) * Math.cos(v.y * k2 * 3) + 0.08 * Math.sin(v.z * 7);
    v.multiplyScalar(n);
    v.y *= 1.2;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, material(spec, r)));
  return g;
}

export function buildModel(spec: ModelSpec): THREE.Group {
  const r = rng(spec.seed);
  const shapes = [vessel, totem, crystal];
  const g = shapes[Math.floor(r() * shapes.length)](spec, r);
  g.name = 'modelo';
  return g;
}

export function stats(group: THREE.Object3D): { faces: number; vertices: number } {
  let faces = 0, vertices = 0;
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry;
    vertices += geo.attributes['position'].count;
    faces += geo.index ? geo.index.count / 3 : geo.attributes['position'].count / 3;
  });
  return { faces: Math.round(faces), vertices };
}

export async function exportModel(group: THREE.Object3D, format: ExportFormat): Promise<Blob> {
  switch (format) {
    case 'glb': {
      const out = await new GLTFExporter().parseAsync(group, { binary: true });
      return new Blob([out as ArrayBuffer], { type: 'model/gltf-binary' });
    }
    case 'obj':
      return new Blob([new OBJExporter().parse(group)], { type: 'model/obj' });
    case 'stl': {
      const out = new STLExporter().parse(group, { binary: true }) as unknown as DataView;
      return new Blob([out.buffer as ArrayBuffer], { type: 'model/stl' });
    }
    case 'usdz': {
      const out = await new USDZExporter().parseAsync(group);
      return new Blob([out as Uint8Array<ArrayBuffer>], { type: 'model/vnd.usdz+zip' });
    }
    default:
      throw new Error(`Formato no disponible en el proveedor falso: ${format}`);
  }
}

let thumbRenderer: THREE.WebGLRenderer | null = null;

/** Miniatura JPEG de 256 px, como haría postprocess en el trabajador. */
export function renderThumbnail(group: THREE.Object3D, background: string): string | null {
  try {
    thumbRenderer ??= new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    const size = 256;
    thumbRenderer.setSize(size, size, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(background);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 2);
    d.position.set(2, 3, 2);
    scene.add(d);
    const clone = group.clone();
    scene.add(clone);
    const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    frame(cam, clone);
    thumbRenderer.render(scene, cam);
    return thumbRenderer.domElement.toDataURL('image/jpeg', 0.82);
  } catch {
    return null; // sin WebGL: la tarjeta muestra un marcador
  }
}

/** Coloca la cámara para que el objeto quepa entero. */
export function frame(cam: THREE.PerspectiveCamera, obj: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(obj);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.1;
  cam.position.set(sphere.center.x + dist * 0.6, sphere.center.y + dist * 0.35, sphere.center.z + dist * 0.75);
  cam.lookAt(sphere.center);
  cam.near = dist / 100;
  cam.far = dist * 10;
  cam.updateProjectionMatrix();
  return dist;
}
