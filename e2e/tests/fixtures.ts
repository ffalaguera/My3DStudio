import { test as base, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { deflateSync } from 'node:zlib';
import pg from 'pg';

const DB = 'postgres://postgres:postgres@localhost:54329/my3dstudio';

/** Errores de consola y respuestas 5xx: cualquier test que los produzca falla. */
export const test = base.extend<{ guard: void }>({
  guard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        // Chrome registra como error cualquier 4xx de fetch; los 4xx esperados (402, 403, 422…) no son fallos
        // de la app. Los 5xx se vigilan aparte con el evento response.
        if (/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) return;
        problems.push(`consola: ${m.text()}`);
      });
      page.on('pageerror', (e) => problems.push(`excepción: ${e.message}`));
      page.on('response', (r) => {
        if (r.status() >= 500) problems.push(`${r.status()} en ${r.url()}`);
      });
      await use();
      expect(problems, 'errores de consola o 5xx').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

let n = 0;
export function uniqueEmail(label = 'e2e') {
  return `${label}-${Date.now()}-${++n}@example.com`;
}

/** Entra con el acceso local (servidor con LOCAL_AUTH=1) usando el modal S02, como un usuario. */
/**
 * Entra con un usuario nuevo. Como ya no hay generaciones gratis, por defecto el usuario llega con 100 créditos
 * de pack (como si hubiera comprado), creados por la API antes de entrar para no tener que recargar la página.
 * `credits: 0` deja la cuenta vacía, como la de alguien recién registrado.
 */
export async function signIn(page: Page, email = uniqueEmail(), opts: { credits?: number } = {}) {
  const credits = opts.credits ?? 100;
  if (credits > 0) {
    const r = await fetch('http://localhost:8787/api/dev/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
    });
    const { token } = (await r.json()) as { token: string };
    await fetch('http://localhost:8787/api/me', { headers: { Authorization: `Bearer ${token}` } }); // crea el perfil
    await sql(`update credit_accounts set permanent_balance = $2 where user_id = (select id from profiles where email = $1)`,
      [email.toLowerCase(), credits]);
  }
  const dialog = page.getByRole('dialog', { name: 'Entra y empieza a crear' });
  // si una acción ya abrió (o está abriendo) el acceso, no se pulsa Entrar debajo del modal
  const opened = await dialog.waitFor({ state: 'visible', timeout: 1500 }).then(() => true, () => false);
  if (!opened) {
    await page.getByRole('navigation', { name: 'Principal' }).getByRole('button', { name: 'Entrar' }).click();
  }
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByRole('button', { name: 'Recibir enlace de acceso' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('link', { name: /Créditos disponibles/ })).toBeVisible();
  return email;
}

export async function credits(page: Page): Promise<number> {
  const label = await page.getByRole('link', { name: /Créditos disponibles/ }).getAttribute('aria-label');
  return Number(label!.replace(/\D/g, ''));
}

/** PNG real (decodificable por el navegador) de un color liso. */
export function png(size = 512, rgb: [number, number, number] = [200, 90, 50]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, c) => {
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function chooseImage(page: Page, name = 'jarron.png', size = 512) {
  await page.locator('input[type="file"]').first().setInputFiles({ name, mimeType: 'image/png', buffer: png(size) });
}

/** Acceso directo a la base local para preparar estados (plan, saldo) que el usuario no puede forzar. */
export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, args: unknown[] = []) {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try {
    return (await c.query<T>(text, args)).rows;
  } finally {
    await c.end();
  }
}

export async function setPlan(email: string, plan: 'free' | 'pro' | 'max', monthly?: number) {
  await sql(`update profiles set plan_id = $2 where email = $1`, [email, plan]);
  if (monthly !== undefined) await sql(`update credit_accounts set monthly_balance = $2 where user_id = (select id from profiles where email = $1)`, [email, monthly]);
}

/** axe WCAG 2.1 AA. Devuelve las violaciones en texto legible para el informe. */
export async function a11y(page: Page, include?: string) {
  let b = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) b = b.include(include);
  const r = await b.analyze();
  return r.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

/** Espera a que la tarea seleccionada termine y el visor muestre el modelo. */
export async function waitForModel(page: Page) {
  await expect(page.getByRole('region', { name: 'Resultado' }).getByRole('button', { name: 'Exportar' })).toBeVisible({ timeout: 45_000 });
}
