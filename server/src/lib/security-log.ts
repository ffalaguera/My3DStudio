/**
 * Registro de actividad sospechosa: una línea JSON por evento ({"sec": "..."}) en la salida de errores,
 * fácil de filtrar en los logs del hosting. Si una misma IP (o usuario) acumula `threshold` eventos de un tipo
 * en 10 minutos, emite una sola línea {"sec":"alert"} por ventana: conéctala a una alerta del hosting
 * (replica/security.md). Sin datos personales: la IP se recorta (IPv4 /24, IPv6 /48) y no se guardan emails.
 */
export type SecurityKind =
  | 'auth_failed' | 'rate_limited' | 'bad_signature' | 'forbidden' | 'bad_input' | 'payment_mismatch' | 'not_found_probe';

export interface SecurityEvent {
  kind: SecurityKind;
  ip?: string;
  userId?: string;
  path?: string;
  detail?: string;
}

export interface SecurityLog {
  record(e: SecurityEvent): void;
}

const WINDOW_MS = 10 * 60_000;

/** 203.0.113.77 → 203.0.113.0 · 2001:db8:1:2::5 → 2001:db8:1::/48 */
export function maskIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.replace(/\.\d+$/, '.0');
  if (ip === '::1') return '::1';
  // IPv6 completa (expande '::') y se queda con los 3 primeros grupos (/48)
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return groups.length === 8 ? `${groups.slice(0, 3).join(':')}::/48` : undefined;
}

export function createSecurityLog(opts: {
  sink?: (line: Record<string, unknown>) => void;
  threshold?: number;
  now?: () => number;
} = {}): SecurityLog {
  const sink = opts.sink ?? ((line) => console.warn(JSON.stringify(line)));
  const threshold = opts.threshold ?? 20;
  const now = opts.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number; alerted: boolean }>();

  return {
    record(e) {
      const ip = maskIp(e.ip);
      const t = now();
      sink({ sec: e.kind, at: new Date(t).toISOString(), ip, user: e.userId, path: e.path, detail: e.detail?.slice(0, 200) });
      const who = e.userId ?? ip ?? 'desconocido';
      const key = `${e.kind}|${who}`;
      let w = windows.get(key);
      if (!w || t - w.start > WINDOW_MS) {
        w = { start: t, count: 0, alerted: false };
        windows.set(key, w);
      }
      w.count++;
      if (w.count >= threshold && !w.alerted) {
        w.alerted = true;
        sink({ sec: 'alert', at: new Date(t).toISOString(), kind: e.kind, ip, user: e.userId, count: w.count, windowMinutes: WINDOW_MS / 60_000 });
      }
      if (windows.size > 10_000) {
        for (const [k, v] of windows) if (t - v.start > WINDOW_MS) windows.delete(k);
      }
    },
  };
}
