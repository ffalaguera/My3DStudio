import { a11y, expect, signIn, sql, test, waitForModel } from './fixtures';
import type { Page } from '@playwright/test';

async function makeModel(page: Page, prompt: string) {
  await page.goto('/crear');
  await page.getByRole('radio', { name: 'Texto' }).click();
  await page.getByLabel('Describe el objeto').fill(prompt);
  await page.getByRole('button', { name: /^Generar/ }).click();
  await waitForModel(page);
}

test.describe('F05 mis modelos', () => {
  test('F05-H1 renombrar desde el visor', async ({ page }) => {
    await page.goto('/');
    await signIn(page);
    await makeModel(page, 'una jarra');
    await page.getByRole('button', { name: 'Renombrar' }).click();
    await page.getByRole('textbox', { name: 'Nombre del modelo' }).fill('Jarra de agua');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Resultado' }).getByRole('heading', { name: 'Jarra de agua' })).toBeVisible();
    await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Mis modelos' }).click();
    await expect(page.getByRole('link', { name: /Jarra de agua/ })).toBeVisible();
  });

  test('F05-H2 + F05-H3 filtrar, buscar sin resultados y borrar', async ({ page }) => {
    await page.goto('/');
    await signIn(page);
    await makeModel(page, 'una taza');
    await page.goto('/mis-modelos');
    await expect(page.getByRole('link', { name: /una taza/ })).toBeVisible();
    expect(await a11y(page), 'axe S06').toEqual([]);
    await page.getByRole('button', { name: 'Topología limpia' }).click();
    await expect(page.getByText('Nada coincide con tu búsqueda')).toBeVisible();
    await page.getByRole('button', { name: 'Quitar filtros' }).click();
    await page.getByRole('textbox', { name: 'Buscar en tus modelos' }).fill('taza');
    await expect(page.getByRole('link', { name: /una taza/ })).toBeVisible();
    await page.getByRole('button', { name: 'Acciones de una taza' }).click();
    await page.getByRole('menuitem', { name: 'Borrar' }).click();
    const dialog = page.getByRole('dialog', { name: '¿Borrar este modelo?' });
    await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Borrar' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Has borrado «una taza»' })).toBeVisible();
    await expect(page.getByRole('link', { name: /una taza/ })).toHaveCount(0);
  });

  test('F05-E1 nombre de 60+ caracteres', async ({ page }) => {
    await page.goto('/');
    await signIn(page);
    const long = 'una lámpara de pie de estilo industrial con brazo articulado y pantalla de latón envejecido';
    await makeModel(page, long);
    await page.goto('/mis-modelos');
    const name = page.getByRole('main').getByText(long.slice(0, 40), { exact: false }).first();
    await expect(name).toBeVisible();
    const fits = await name.evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis');
    expect(fits).toBe(true);
  });

  test('F05-E2 borrado en otra pestaña: "Este modelo ya no existe"', async ({ page, context }) => {
    await page.goto('/');
    await signIn(page);
    await makeModel(page, 'un cuenco');
    const url = page.url();
    const id = new URL(url).searchParams.get('modelo')!;
    await sql('delete from assets where id = $1', [id]);
    const other = await context.newPage();
    await other.goto(url);
    // la sesión local vive en sessionStorage (por pestaña): entrar otra vez no hace falta para ver el aviso
    await expect(other.getByText(/ya no existe|Entra para ver/)).toBeVisible();
    await page.reload();
    await expect(page.getByRole('alert').filter({ hasText: 'Este modelo ya no existe' })).toBeVisible();
  });

  test('F04-N3 cuenta bloqueada por una disputa: no puede generar', async ({ page }) => {
    await page.goto('/crear');
    const email = await signIn(page);
    await sql(`update profiles set blocked_at = now(), blocked_reason = 'Disputa de un pago' where email = $1`, [email.toLowerCase()]);
    await page.getByRole('radio', { name: 'Texto' }).click();
    await page.getByLabel('Describe el objeto').fill('una lámpara');
    await page.getByRole('button', { name: /^Generar/ }).click();
    await expect(page.getByRole('alert').or(page.getByRole('status')).filter({ hasText: 'Tu cuenta está bloqueada' }).first()).toBeVisible();
  });

  test('BUG-010 abrir el enlace de un modelo sin sesión y entrar: el modelo se carga sin recargar', async ({ page, browser }) => {
    await page.goto('/');
    const email = await signIn(page);
    await makeModel(page, 'un enlace compartido');
    const url = page.url();
    const ctx2 = await browser.newContext();
    const other = await ctx2.newPage();
    await other.goto(url);
    await signIn(other, email); // el mismo usuario en otro navegador
    await expect(other.getByRole('region', { name: 'Resultado' }).getByRole('heading', { name: 'un enlace compartido' })).toBeVisible();
    await ctx2.close();
  });

  test('F05-N2 modelo de otro usuario: no se ve nada', async ({ page, browser }) => {
    await page.goto('/');
    await signIn(page);
    await makeModel(page, 'un secreto');
    const id = new URL(page.url()).searchParams.get('modelo')!;
    const ctx2 = await browser.newContext();
    const other = await ctx2.newPage();
    await other.goto('/');
    await signIn(other);
    await other.goto(`/crear?modelo=${id}`);
    await expect(other.getByRole('alert').filter({ hasText: 'Este modelo ya no existe' })).toBeVisible();
    await expect(other.getByText('un secreto')).toHaveCount(0);
    await ctx2.close();
  });
});
