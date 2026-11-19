import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { convert } from '../src/lib/convert.js';
import { vesselGlb } from '../src/provider/fake.js';
import { HttpError } from '../src/lib/http.js';

const blender = process.env['BLENDER_PATH'] ?? '';
const hasBlender = !!blender && existsSync(blender);

describe('3MF (en el servidor, sin Blender)', () => {
  it('ZIP con la estructura de 3MF, metros → milímetros, y tantos triángulos como el GLB', async () => {
    const glb = await vesselGlb(5, 16, 8, [0.5, 0.5, 0.5]); // 16 × 8 × 2 = 256 triángulos
    const out = await convert(glb, '3mf');
    const files = unzipSync(new Uint8Array(out));
    expect(Object.keys(files).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    const model = strFromU8(files['3D/3dmodel.model']);
    expect(model).toMatch(/<model unit="millimeter"/);
    expect(model.match(/<triangle /g)).toHaveLength(256);
    expect(model.match(/<vertex /g)).toHaveLength(17 * 9);
    // el jarrón falso mide 1,8 m de alto en glTF (metros): en 3MF son 1800 mm
    const ys = [...model.matchAll(/<vertex x="[^"]+" y="([^"]+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1800, 0);
    expect(strFromU8(files['_rels/.rels'])).toContain('Target="/3D/3dmodel.model"');
  });
});

describe('Blender', () => {
  it('si Blender no crea el archivo, el error es claro (no un ENOENT)', async () => {
    // un "Blender" que termina bien pero no hace nada
    const dir = mkdtempSync(join(tmpdir(), 'fake-blender-'));
    const fake = join(dir, process.platform === 'win32' ? 'fake.cmd' : 'fake.sh');
    writeFileSync(fake, process.platform === 'win32' ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const glb = await vesselGlb(5, 8, 4, [0.5, 0.5, 0.5]);
    const e = await convert(glb, 'fbx', fake).catch((x) => x);
    expect(e).toBeInstanceOf(HttpError);
    expect(e.status).toBe(500);
    expect(e.message).toBe('No se ha podido convertir el modelo a FBX. Prueba con GLB u OBJ');
  });

  it.skipIf(!hasBlender)('FBX binario y USDZ con Blender real', async () => {
    const glb = await vesselGlb(5, 16, 8, [0.5, 0.5, 0.5]);
    const fbx = await convert(glb, 'fbx', blender);
    expect(fbx.subarray(0, 18).toString('latin1')).toBe('Kaydara FBX Binary');
    const usdz = await convert(glb, 'usdz', blender);
    expect(usdz.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004');
    expect(Object.keys(unzipSync(new Uint8Array(usdz))).some((f) => f.endsWith('.usdc') || f.endsWith('.usda'))).toBe(true);
  }, 300_000);
});
