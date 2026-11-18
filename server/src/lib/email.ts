import { Resend } from 'resend';
import type { Config } from '../config.js';

export interface Mailer {
  send(to: string, template: Template): Promise<void>;
}

// Plantillas propias, solo transaccionales.
export type Template =
  | { kind: 'payment_failed'; planName: string; portalUrl: string }
  | { kind: 'account_deleted' };

function render(t: Template): { subject: string; text: string } {
  switch (t.kind) {
    case 'payment_failed':
      return {
        subject: 'No hemos podido cobrar tu plan',
        text: `Hola:\n\nEl último cobro de tu plan ${t.planName} no ha salido. Tus modelos siguen ahí; ` +
          `actualiza la tarjeta para no perder los créditos del mes:\n${t.portalUrl}\n\nSi ya lo has hecho, ignora este correo.`,
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
      console.log(`[email] (sin enviar) ${render(t).subject}`);
    },
  };
}
