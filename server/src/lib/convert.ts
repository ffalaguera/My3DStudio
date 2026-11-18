import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { NodeIO, type Document } from '@gltf-transform/core';
import { HttpError } from './http.js';

const run = promisify(execFile);
export type Format = 'glb' | 'obj' | 'stl' | 'usdz' | 'fbx' | '3mf';
export const CONTENT_TYPE: Record<Format, string> = {
  glb: 'model/gltf-binary', obj: 'model/obj', stl: 'model/stl', usdz: 'model/vnd.usdz+zip',
  fbx: 'application/octet-stream', '3mf': 'model/3mf',
};

interface Tri { positions: Float32Array; indices: Uint32Array }

/** Junta todas las mallas del GLB en coordenadas de mundo. */
function triangles(doc: Document): Tri[] {
  const out: Tri[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue; // solo TRIANGLES
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const p = new Float32Array(pos.getCount() * 3);
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        p[i * 3] = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
        p[i * 3 + 1] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
        p[i * 3 + 2] = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
      }
      const ix = prim.getIndices();
      const indices = ix ? Uint32Array.from(ix.getArray() as ArrayLike<number>) : Uint32Array.from({ length: pos.getCount() }, (_, i) => i);
      out.push({ positions: p, indices });
    }
  }
  return out;
}

export async function stats(glb: Buffer): Promise<{ faces: number; vertices: number }> {
  const doc = await new NodeIO().readBinary(new Uint8Array(glb));
  let faces = 0, vertices = 0;
  for (const t of triangles(doc)) {
    faces += t.indices.length / 3;
    vertices += t.positions.length / 3;
  }
  return { faces, vertices };
}

function toObj(tris: Tri[]): Buffer {
  const lines: string[] = ['# exportado por Forma'];
  let offset = 1;
  tris.forEach((t, n) => {
    lines.push(`o malla_${n}`);
    for (let i = 0; i < t.positions.length; i += 3) lines.push(`v ${t.positions[i]} ${t.positions[i + 1]} ${t.positions[i + 2]}`);
    for (let i = 0; i < t.indices.length; i += 3) lines.push(`f ${t.indices[i] + offset} ${t.indices[i + 1] + offset} ${t.indices[i + 2] + offset}`);
    offset += t.positions.length / 3;
  });
  return Buffer.from(lines.join('\n') + '\n');
}

function toStl(tris: Tri[]): Buffer {
  const count = tris.reduce((n, t) => n + t.indices.length / 3, 0);
  const buf = Buffer.alloc(84 + count * 50);
  buf.write('Forma STL', 0);
  buf.writeUInt32LE(count, 80);
  let o = 84;
  for (const t of tris) {
    const P = t.positions;
    for (let i = 0; i < t.indices.length; i += 3) {
      const [a, b, c] = [t.indices[i] * 3, t.indices[i + 1] * 3, t.indices[i + 2] * 3];
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      for (const f of [nx, ny, nz, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]]) {
        buf.writeFloatLE(f, o);
        o += 4;
      }
      o += 2; // attribute byte count
    }
  }
  return buf;
}

/** FBX, USDZ y 3MF con Blender sin interfaz (trabajo `convert` de architecture.md). */
async function viaBlender(blender: string, glb: Buffer, format: 'fbx' | 'usdz' | '3mf'): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'forma-'));
  try {
    const src = join(dir, 'in.glb'), dst = join(dir, `out.${format}`);
    await writeFile(src, glb);
    const exporter = {
      fbx: `bpy.ops.export_scene.fbx(filepath=r'${dst}', path_mode='COPY', embed_textures=True)`,
      usdz: `bpy.ops.wm.usd_export(filepath=r'${dst}')`,
      '3mf': `bpy.ops.export_mesh.threemf(filepath=r'${dst}')`, // requiere el add-on 3MF
    }[format];
    const py = `import bpy\nbpy.ops.wm.read_factory_settings(use_empty=True)\nbpy.ops.import_scene.gltf(filepath=r'${src}')\n${exporter}\n`;
    await run(blender, ['-b', '--factory-startup', '--python-expr', py], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
    return await readFile(dst);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function convert(glb: Buffer, format: Format, blenderPath?: string): Promise<Buffer> {
  if (format === 'glb') return glb;
  if (format === 'obj' || format === 'stl') {
    const tris = triangles(await new NodeIO().readBinary(new Uint8Array(glb)));
    return format === 'obj' ? toObj(tris) : toStl(tris);
  }
  if (!blenderPath) throw new HttpError(501, 'server_conversion', 'Este formato necesita Blender en el servidor y aún no está activado');
  return viaBlender(blenderPath, glb, format);
}
