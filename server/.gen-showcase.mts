// Genera los modelos de muestra de la portada con el motor real (fal). Uso único; el resultado va a web/public/showcase.
import { mkdirSync, writeFileSync } from 'node:fs';
import { FalProvider } from './src/provider/fal.ts';
const key = process.env.FAL_KEY;
if (!key) throw new Error('falta FAL_KEY');
const fal = new FalProvider({ key } as never);
const out = '../web/public/showcase';
mkdirSync(out, { recursive: true });
const items = [
  ['dragon', 'Un dragón pequeño posado sobre una roca, figura de miniatura para juego de rol de mesa, muy detallado'],
  ['estacion', 'Una pequeña estación de tren rural de piedra y madera para maqueta de tren de jardín'],
  ['buho', 'Un búho decorativo de cerámica sentado, con plumas talladas'],
  ['caballo', 'La pieza de ajedrez del caballo con armadura medieval, sobre peana redonda'],
  ['maceta', 'Una maceta geométrica facetada con una suculenta dentro'],
];
const done: Record<string, unknown>[] = [];
await Promise.all([0, 1].map(async (lane) => {
  for (let i = lane; i < items.length; i += 2) {
    const [slug, prompt] = items[i];
    const t0 = Date.now();
    try {
      const r = await fal.generate({ taskId: `showcase-${slug}`, type: 'text_to_model', series: 'smart', prompt,
        params: { texture: true, textureResolution: '2k', pbr: true, topology: 'tri', faceLimit: 20000, variants: 1 } },
        async () => {}, new AbortController().signal);
      writeFileSync(`${out}/${slug}.glb`, r.variants[0]);
      done.push({ slug, prompt, engine: r.modelVersion, bytes: r.variants[0].length, seconds: Math.round((Date.now() - t0) / 1000) });
      console.log('ok', slug, r.variants[0].length, Math.round((Date.now() - t0) / 1000) + 's');
    } catch (e) { console.log('fallo', slug, (e as Error).message); }
  }
}));
writeFileSync(`${out}/provenance.json`, JSON.stringify({ generated: new Date().toISOString(), tool: 'My3DStudio (fal TRELLIS.2 + FLUX.1 schnell)', items: done }, null, 2));
