import type { NextFunction, Request, Response } from 'express';
import { z, ZodError } from 'zod';

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

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
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
  // Sin datos del usuario en los logs: solo el mensaje y la pila.
  console.error('[api] error no controlado:', (err as Error).message, (err as Error).stack?.split('\n')[1]?.trim());
  res.status(500).json({ error: { code: 'internal', message: 'Algo ha fallado. Inténtalo de nuevo' } });
}
