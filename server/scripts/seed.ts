// Datos de ejemplo realistas (sin personas reales) y precios de Stripe desde el entorno.
// Uso: npm run seed
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createCtx } from '../src/app.js';
import { ensureProfile } from '../src/lib/auth.js';
import { tx } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { stats } from '../src/lib/convert.js';
import { vesselGlb } from '../src/provider/fake.js';

const cfg = loadConfig();
const ctx = createCtx(cfg);
await migrate(ctx.db, { local: cfg.LOCAL_AUTH });

// 1. Ids de precio de Stripe (modo test) para los planes de pago.
for (const [plan, interval] of [['pro', 'month'], ['pro', 'year'], ['max', 'month'], ['max', 'year']] as const) {
  const env = process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`];
  if (env) {
    await ctx.db.query(`update plans set stripe_price_${interval}_id = $2 where id = $1`, [plan, env]);
    console.log(`precio ${plan}/${interval} enlazado`);
  }
}

// 2. Usuario de demostración con modelos (solo en local).
if (cfg.LOCAL_AUTH) {
  const email = 'demo@example.com';
  const id = (await ctx.db.query(
    `insert into auth.users (id, email) values ($1, $2) on conflict (email) do update set email = excluded.email returning id`,
    [randomUUID(), email])).rows[0].id as string;
  await tx(ctx.db, (c) => ensureProfile(c, { id, email }));
  const has = Number((await ctx.db.query('select count(*) from assets where user_id = $1', [id])).rows[0].count);
  const samples = [
    { prompt: 'jarrón de cerámica esmaltada en azul', series: 'hd', hue: [0.25, 0.4, 0.7] },
    { prompt: 'maceta de terracota con borde ancho', series: 'smart', hue: [0.75, 0.42, 0.28] },
    { prompt: 'botella de vidrio verde para una tienda', series: 'hd', hue: [0.3, 0.6, 0.4] },
  ] as const;
  if (!has) {
    for (const [i, s] of samples.entries()) {
      const taskId = randomUUID(), assetId = randomUUID();
      const glb = await vesselGlb(1000 + i, s.series === 'hd' ? 160 : 40, s.series === 'hd' ? 80 : 20, [...s.hue] as [number, number, number]);
      const key = `u/${id}/assets/${assetId}/model.glb`;
      await ctx.storage.write(key, glb, 'model/gltf-binary');
      const st = await stats(glb);
      await ctx.db.query(
        `insert into tasks (id, user_id, type, series, status, progress, prompt, params, idempotency_key, provider, finished_at, started_at)
         values ($1,$2,'text_to_model',$3,'success',100,$4,$5,$6,'fake', now(), now())`,
        [taskId, id, s.series, s.prompt, { texture: true, textureResolution: '2k', pbr: true, topology: 'quad', faceLimit: 5000, variants: 1 }, `seed-${i}`]);
      await ctx.db.query(
        `insert into assets (id, user_id, task_id, kind, source, name, slug, prompt, series, model_version, face_count, vertex_count,
                             topology, texture_resolution, has_texture, privacy, license, expires_at)
         values ($1,$2,$3,'model','generated',$4,$5,$4,$6,'fake-1',$7,$8,'tri','2k',true,'public','attribution', now() + interval '1 day')`,
        [assetId, id, taskId, s.prompt, `ejemplo-${i}`, s.series, st.faces, st.vertices]);
      await ctx.db.query(`insert into asset_files (asset_id, format, storage_key, size_bytes) values ($1,'glb',$2,$3)`, [assetId, key, glb.length]);
    }
    console.log(`usuario ${email} con ${samples.length} modelos de ejemplo`);
  } else console.log(`usuario ${email} ya tenía datos`);
}
await ctx.db.end();
