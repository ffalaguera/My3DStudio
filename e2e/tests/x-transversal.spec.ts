import { a11y, expect, signIn, sql, test, waitForModel } from './fixtures';

test.describe('Transversales', () => {
  test('X-3 cuenta: movimientos, cerrar sesión y borrar cuenta', async ({ page }) => {
    await page.goto('/cuenta');
    const email = await signIn(page);
    await expect(page.getByRole('table')).toContainText('Créditos de bienvenida');
    expect(await a11y(page), 'axe S12').toEqual([]);
    await page.getByRole('button', { name: 'Borrar cuenta' }).click();
    const dialog = page.getByRole('dialog', { name: '¿Borrar tu cuenta?' });
    const confirm = dialog.getByRole('button', { name: 'Borrar cuenta' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Escribe BORRAR para confirmar').fill('BORRAR');
    await confirm.click();
    await expect(page.getByRole('status').filter({ hasText: 'Tu cuenta y tus datos se han borrado' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('button', { name: 'Entrar' })).toBeVisible();
    expect(await sql('select 1 from profiles where email = $1', [email])).toHaveLength(0);
  });

  test('X-3b cerrar sesión', async ({ page }) => {
    await page.goto('/cuenta');
    await signIn(page);
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page).toHaveURL('http://localhost:4300/');
    await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('button', { name: 'Entrar' })).toBeVisible();
  });

  test('X-4 zona horaria: la caducidad se muestra en la hora local del navegador', async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: 'America/New_York', locale: 'es-ES' });
    const page = await ctx.newPage();
    await page.goto('/crear');
    await signIn(page);
    await page.getByRole('radio', { name: 'Texto' }).click();
    await page.getByLabel('Describe el objeto').fill('un reloj');
    await page.getByRole('button', { name: /^Generar/ }).click();
    await waitForModel(page);
    const id = new URL(page.url()).searchParams.get('modelo')!;
    const [{ expires_at }] = await sql<{ expires_at: Date }>('select expires_at from assets where id = $1', [id]);
    const local = new Intl.DateTimeFormat('es-ES', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(expires_at);
    await expect(page.getByRole('region', { name: 'Resultado' }).getByText(new RegExp(`Se borra el .*${local}`))).toBeVisible();
    await ctx.close();
  });

  test('X-5 página que no existe', async ({ page }) => {
    await page.goto('/no-existe');
    await expect(page.getByRole('heading', { name: 'Esta página no existe' })).toBeVisible();
    expect(await a11y(page)).toEqual([]);
  });

  test('X-1 accesibilidad del acceso (S02) y del espacio de trabajo vacío (S03)', async ({ page }) => {
    await page.goto('/crear');
    expect(await a11y(page), 'axe S03 sin sesión').toEqual([]);
    await page.getByRole('navigation', { name: 'Principal' }).getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('dialog', { name: 'Entra y empieza a crear' })).toBeVisible();
    expect(await a11y(page, 'dialog[open]'), 'axe S02').toEqual([]);
  });
});
