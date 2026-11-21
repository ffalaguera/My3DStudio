// Genera dist/web/browser/_headers (formato de Cloudflare Pages y Netlify) con la CSP y las cabeceras de seguridad.
// La CSP se construye con los orígenes reales de config.json (API, Supabase) y el almacén de archivos.
// Uso: node scripts/security-headers.mjs [carpeta-dist] [origen-almacen]
//   npm run build:prod   (compila y genera las cabeceras)
// El origen del almacén (URLs firmadas de R2) va en STORAGE_ORIGIN, p. ej. https://<cuenta>.r2.cloudflarestorage.com
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist/web/browser';
const cfg = JSON.parse(readFileSync(join(dist, 'config.json'), 'utf8'));
const origin = (u) => (u ? new URL(u).origin : null);
const api = origin(cfg.apiUrl);
const supabase = origin(cfg.supabaseUrl);
const storage = process.argv[3] ?? process.env.STORAGE_ORIGIN ?? null;
if (cfg.api === 'http' && !api) throw new Error('config.json: falta apiUrl');
const prod = !!api?.startsWith('https://');
if (prod && cfg.auth !== 'supabase') throw new Error('config.json de producción con auth distinto de supabase');
// En local, Supabase no está; el almacén lo sirve la propia API (/files).
const files = [api, storage].filter(Boolean);
const connect = ["'self'", api, supabase, supabase?.replace('https://', 'wss://'), ...files].filter(Boolean);

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  // Angular añade estilos de componente en <style>; sin scripts en línea, esto no abre la puerta al XSS.
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${files.join(' ')}`.trim(),
  "font-src 'self'",
  `connect-src ${[...new Set(connect)].join(' ')} blob:`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(prod ? ['upgrade-insecure-requests'] : []),
].join('; ');

const all = [
  `Content-Security-Policy: ${csp}`,
  'X-Content-Type-Options: nosniff',
  'X-Frame-Options: DENY',
  'Referrer-Policy: strict-origin-when-cross-origin',
  'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy: same-origin',
  ...(prod ? ['Strict-Transport-Security: max-age=31536000; includeSubDomains'] : []),
];

const out = [
  '/*', ...all.map((h) => `  ${h}`),
  '', '/index.html', '  Cache-Control: no-cache',
  '', '/config.json', '  Cache-Control: no-cache',
  '',
].join('\n');
writeFileSync(join(dist, '_headers'), out);
console.log(`_headers generado en ${dist}\n${out}`);
