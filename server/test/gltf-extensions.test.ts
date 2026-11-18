import { expect, it } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { convert, stats } from '../src/lib/convert.js';
import { stripTextures } from '../src/provider/fal.js';

/** GLB como los que devuelve fal/TRELLIS.2: textura WebP con la extensión EXT_texture_webp obligatoria. */
async function webpGlb(): Promise<Buffer> {
  const doc = new Document();
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const buffer = doc.createBuffer();
  const tex = doc.createTexture('base').setMimeType('image/webp').setImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]));
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setBuffer(buffer).setArray(new Float32Array([0, 0, 1, 0, 0, 1])))
    .setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(new Uint32Array([0, 1, 2])))
    .setMaterial(doc.createMaterial('m').setBaseColorTexture(tex));
  doc.createScene().addChild(doc.createNode('n').setMesh(doc.createMesh('m').addPrimitive(prim)));
  return Buffer.from(await new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(doc));
}

it('BUG-009 GLB con EXT_texture_webp (como los de fal): estadísticas, OBJ/STL y "sin textura" funcionan', async () => {
  const glb = await webpGlb();
  expect(await stats(glb)).toEqual({ faces: 1, vertices: 3 });
  expect((await convert(glb, 'obj')).toString()).toContain('f 1 2 3');
  expect((await convert(glb, 'stl')).readUInt32LE(80)).toBe(1);
  const plain = await stripTextures(glb);
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(plain));
  expect(doc.getRoot().listTextures()).toHaveLength(0);
});
