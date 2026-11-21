import type { NextFunction, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import type { SecurityKind, SecurityLog } from './security-log.js';

/** Error con código HTTP y código estable que el frontend convierte en ApiError. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const uuid = z.string().uuid();

export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  return schema.parse(value);
}

/** Qué respuestas de error cuentan como actividad sospechosa (lib/security-log.ts). */
function securityKind(err: HttpError): SecurityKind | null {
  if (err.status === 401) return 'auth_failed';
  if (err.status === 429) return 'rate_limited';
  if (err.code === 'bad_signature') return 'bad_signature';
  if (err.code === 'bad_json') return 'bad_input';
  return null;
}

export function errorHandler(ctx: { security: SecurityLog }) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const log = (kind: SecurityKind, detail?: string) =>
      ctx.security.record({ kind, ip: req.ip, userId: req.user?.id, path: req.originalUrl.split('?')[0], detail });

    if ((err as { type?: string }).type === 'entity.parse.failed') err = new HttpError(400, 'bad_json', 'El cuerpo no es JSON válido');
    if (err instanceof HttpError) {
      const kind = securityKind(err);
      if (kind) log(kind, err.code);
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof ZodError) {
      const first = err.issues[0];
      res.status(422).json({ error: { code: 'invalid_input', message: `Dato no válido: ${first.path.join('.') || 'cuerpo'}` } });
      return;
    }
    if ((err as { type?: string }).type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'too_large', message: 'El archivo es demasiado grande' } });
      return;
    }
    // Sin datos del usuario en los logs: solo el mensaje y la primera línea de la pila. Nunca la pila al cliente.
    console.error('[api] error no controlado:', (err as Error).message, (err as Error).stack?.split('\n')[1]?.trim());
    res.status(500).json({ error: { code: 'internal', message: 'Algo ha fallado. Inténtalo de nuevo' } });
  };
}
