import { Resend } from 'resend';
import type { Config } from '../config.js';

export interface Mailer {
  send(to: string, template: Template): Promise<void>;
}

// Plantillas propias, solo transaccionales.
export type Template =
  | { kind: 'payment_failed'; planName: string; portalUrl: string }
  | { kind: 'account_deleted' }
  | { kind: 'magic_link'; url: string };

function render(t: Template): { subject: string; text: string } {
  switch (t.kind) {
    case 'payment_failed':
      return {
        subject: 'No hemos podido cobrar tu plan',
        text: `Hola:\n\nEl último cobro de tu plan ${t.planName} no ha salido. Tus modelos siguen ahí; ` +
          `actualiza la tarjeta para no perder los créditos del mes:\n${t.portalUrl}\n\nSi ya lo has hecho, ignora este correo.`,
      };
    case 'magic_link':
      return {
        subject: 'Tu enlace para entrar en My3DStudio',
        text: `Hola:\n\nPulsa este enlace para entrar. Caduca en 10 minutos y solo sirve una vez:\n${t.url}\n\n` +
          'Si no has pedido entrar, ignora este correo: nadie puede acceder sin abrir este enlace.',
      };
    case 'account_deleted':
      return {
        subject: 'Tu cuenta se ha borrado',
        text: 'Hola:\n\nHemos borrado tu cuenta, tus modelos y tus archivos, como pediste. Si no has sido tú, responde a este correo.',
      };
  }
}

export function createMailer(cfg: Config): Mailer {
  if (cfg.EMAIL_DRIVER === 'resend') {
    const resend = new Resend(cfg.RESEND_API_KEY);
    return {
      async send(to, t) {
        const { subject, text } = render(t);
        const { error } = await resend.emails.send({ from: cfg.EMAIL_FROM, to, subject, text });
        if (error) throw new Error(`Resend: ${error.message}`);
      },
    };
  }
  return {
    async send(_to, t) {
      // en desarrollo no se envía nada; tampoco se escribe la dirección en el log
      const { subject, text } = render(t);
      console.log(`[email] (sin enviar) ${subject}`);
      // solo en desarrollo, el cuerpo (p. ej. el enlace de acceso) para poder probar sin servicio de email.
      // En producción este driver no se permite con acceso propio (config.ts) y aquí no se imprime nada más.
      if (cfg.NODE_ENV === 'development') console.log(text.split('\n').map((l) => `[email]   ${l}`).join('\n'));
    },
  };
}
