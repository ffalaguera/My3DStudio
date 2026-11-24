// Escribe dist/web/browser/config.json de producción a partir de variables de entorno (las del hosting de la web,
// p. ej. Cloudflare Pages → Settings → Environment variables). Solo valores públicos.
//   PUBLIC_API_URL=https://api.tudominio.com GOOGLE_CLIENT_ID=… node scripts/write-config.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist/web/browser';
const apiUrl = process.env.PUBLIC_API_URL;
if (!apiUrl?.startsWith('https://')) throw new Error('PUBLIC_API_URL tiene que ser https://… (la URL pública de la API)');
const cfg = { api: 'http', apiUrl, auth: 'self', ...(process.env.GOOGLE_CLIENT_ID ? { googleClientId: process.env.GOOGLE_CLIENT_ID } : {}) };
writeFileSync(join(dist, 'config.json'), JSON.stringify(cfg, null, 2) + '\n');
console.log(`config.json de producción: ${JSON.stringify(cfg)}`);
