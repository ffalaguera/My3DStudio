import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { HttpError, uuid } from '../lib/http.js';
import { sniffImage } from '../lib/image.js';
import { assertOwner } from './account.js';

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
const MAX_IMAGE = 20 * 1024 * 1024;

export function uploadRoutes(ctx: Ctx) {
  const r = Router();
  const { db, storage } = ctx;

  /** Paso 1: crea la fila y devuelve una URL firmada para subir directamente al almacén. */
  r.post('/', async (req, res) => {
    const body = z.object({
      kind: z.literal('image'),
      contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      sizeBytes: z.number().int().positive(),
      filename: z.string().max(200).optional(),
    }).parse(req.body);
    if (body.sizeBytes > MAX_IMAGE) {
      throw new HttpError(413, 'too_large', `La imagen pesa ${Math.round(body.sizeBytes / 1048576)} MB. El máximo es 20 MB`);
    }
    const id = randomUUID();
    const key = `u/${req.user!.id}/uploads/${id}.${EXT[body.contentType]}`;
    await db.query(
      `insert into uploads (id, user_id, kind, storage_key, content_type, size_bytes, filename) values ($1,$2,'image',$3,$4,$5,$6)`,
      [id, req.user!.id, key, body.contentType, body.sizeBytes, body.filename?.replace(/[^\p{L}\p{N} ._-]/gu, '') ?? null],
    );
    const put = await storage.signedPut(key, body.contentType, body.sizeBytes);
    res.status(201).json({ uploadId: id, putUrl: put.url, headers: put.headers });
  });

  /** Paso 2: comprueba lo subido (tipo real, tamaño, dimensiones) y lo marca como listo. */
  r.post('/:id/complete', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const row = await db.query('select * from uploads where id = $1 and user_id = $2', [id, req.user!.id]);
    assertOwner(row, 'La subida no existe');
    const u = row.rows[0];
    const bytes = await storage.read(u.storage_key).catch(() => null);
    const reject = async (code: string, message: string) => {
      await db.query(`update uploads set status = 'rejected' where id = $1`, [id]);
      throw new HttpError(422, code, message);
    };
    if (!bytes) return reject('not_uploaded', 'No ha llegado la imagen. Vuelve a subirla');
    if (bytes.length > MAX_IMAGE) return reject('too_large', 'La imagen supera los 20 MB');
    const info = sniffImage(bytes);
    if (!info || info.type !== u.content_type) return reject('invalid_image', 'No se puede leer la imagen. Usa JPG, PNG o WEBP');
    if (Math.min(info.width, info.height) < 256) return reject('too_small', 'La imagen es demasiado pequeña: mínimo 256 px por lado');
    await db.query(`update uploads set status = 'ready', width = $2, height = $3, size_bytes = $4 where id = $1`,
      [id, info.width, info.height, bytes.length]);
    res.json({
      upload: { id, previewUrl: await storage.signedGet(u.storage_key), width: info.width, height: info.height, sizeBytes: bytes.length },
    });
  });

  return r;
}
