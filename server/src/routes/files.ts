import express, { Router } from 'express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Ctx } from '../context.js';
import { HttpError } from '../lib/http.js';
import { LocalStorage, verifyLocal } from '../lib/storage.js';

/**
 * Solo con STORAGE_DRIVER=local: hace de "bucket" con URLs firmadas (HMAC con caducidad),
 * igual que R2 en producción. Sin firma válida no se lee ni se escribe nada.
 */
export function localFiles(ctx: Ctx) {
  const r = Router();
  const storage = ctx.storage as LocalStorage;
  const secret = ctx.cfg.FILE_URL_SECRET!;
  const extras = (q: Record<string, unknown>, keys: string[]) =>
    keys.filter((k) => typeof q[k] === 'string').map((k) => `${k}=${q[k]}`).join('&');

  r.put('/*key', express.raw({ type: () => true, limit: '20mb' }), async (req, res) => {
    const key = (req.params as { key: string[] }).key.join('/');
    const q = req.query as Record<string, string>;
    if (!verifyLocal(secret, 'PUT', key, Number(q['exp']), q['sig'] ?? '', extras(q, ['ct', 'max']))) {
      throw new HttpError(403, 'bad_signature', 'Enlace de subida no válido o caducado');
    }
    if (req.header('content-type') !== q['ct']) throw new HttpError(415, 'unsupported_type', 'Tipo de archivo distinto del declarado');
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(422, 'empty', 'Archivo vacío');
    if (body.length > Number(q['max'])) throw new HttpError(413, 'too_large', 'El archivo es más grande de lo declarado');
    await storage.write(key, body);
    res.status(200).end();
  });

  r.get('/*key', async (req, res) => {
    const key = (req.params as { key: string[] }).key.join('/');
    const q = req.query as Record<string, string>;
    if (!verifyLocal(secret, 'GET', key, Number(q['exp']), q['sig'] ?? '', extras(q, ['dl']))) {
      throw new HttpError(403, 'bad_signature', 'Enlace no válido o caducado');
    }
    const path = storage.path(key);
    const info = await stat(path).catch(() => null);
    if (!info) throw new HttpError(404, 'not_found', 'El archivo no existe');
    const ext = key.split('.').pop()!;
    const types: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', glb: 'model/gltf-binary', obj: 'model/obj', stl: 'model/stl',
      usdz: 'model/vnd.usdz+zip', fbx: 'application/octet-stream', '3mf': 'model/3mf',
    };
    res.setHeader('Content-Type', types[ext] ?? 'application/octet-stream');
    res.setHeader('Content-Length', info.size);
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (q['dl']) res.setHeader('Content-Disposition', `attachment; filename="${q['dl'].replace(/["\\\r\n]/g, '')}"`);
    createReadStream(path).pipe(res);
  });

  return r;
}
