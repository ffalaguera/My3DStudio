import { a11y, chooseImage, expect, signIn, sql, test, waitForModel } from './fixtures';

test.describe('F01 imagen → modelo 3D', () => {
  test('F01-H1 inicio → imagen → crear → visor (tienda: sin descargas)', async ({ page }) => {
    await page.goto('/');
    expect(await a11y(page), 'axe S01').toEqual([]);
    await chooseImage(page, 'jarron.png');
    await expect(page.getByRole('img', { name: 'Imagen de referencia subida' })).toBeVisible();
    await page.getByRole('button', { name: 'Crear mi figura · gratis' }).click();
    // sin sesión: se pide acceso y después arranca sola
    await expect(page.getByRole('dialog', { name: 'Entra y empieza a crear' })).toBeVisible();
    await signIn(page);
    await expect(page).toHaveURL(/\/crear/);
    await expect(page.getByRole('progressbar').first()).toBeVisible();
    expect(await a11y(page), 'axe S04').toEqual([]);
    await waitForModel(page);
    const result = page.getByRole('region', { name: 'Resultado' });
    await expect(result.getByRole('heading', { name: 'jarron' })).toBeVisible();
    await expect(result.getByRole('img', { name: /Modelo 3D: jarron/ })).toBeVisible();
    expect(await a11y(page), 'axe S05').toEqual([]);

    await expect(result.getByRole('button', { name: 'Exportar' })).toHaveCount(0);
  });

  test('F01-E2 doble clic en Generar crea una sola tarea', async ({ page }) => {
    await page.goto('/crear');
    const email = await signIn(page);
    await chooseImage(page);
    await expect(page.getByRole('img', { name: 'Imagen de referencia subida' })).toBeVisible();
    await page.getByRole('button', { name: /^Generar/ }).dblclick();
    await expect(page.getByRole('progressbar').first()).toBeVisible();
    await page.waitForTimeout(1500);
    const rows = await sql(`select count(*)::int as n from tasks t join profiles p on p.id = t.user_id where p.email = $1`, [email]);
    expect(rows[0].n).toBe(1);
  });

  test('F01-E3 recargar a mitad: la tarea sigue y termina', async ({ page }) => {
    await page.goto('/crear');
    await signIn(page);
    await chooseImage(page);
    await expect(page.getByRole('img', { name: 'Imagen de referencia subida' })).toBeVisible();
    await page.getByRole('button', { name: /^Generar/ }).click();
    await expect(page.getByRole('progressbar').first()).toBeVisible();
    await page.reload();
    await waitForModel(page);
    await expect(page.getByRole('complementary', { name: 'Actividad' }).getByText('Listo')).toBeVisible();
  });

  test('F01-E4 salir a Mis modelos durante la generación: el modelo aparece al terminar', async ({ page }) => {
    await page.goto('/crear');
    await signIn(page);
    await chooseImage(page, 'lampara.png');
    await expect(page.getByRole('img', { name: 'Imagen de referencia subida' })).toBeVisible();
    await page.getByRole('button', { name: /^Generar/ }).click();
    await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Mis modelos' }).click();
    await expect(page.getByRole('heading', { name: 'Mis modelos' })).toBeVisible();
    await expect(page.getByRole('link', { name: /lampara/ })).toBeVisible({ timeout: 45_000 });
  });

  test('F01-E5 archivos no válidos: formato y tamaño mínimo', async ({ page }) => {
    await page.goto('/crear');
    await signIn(page);
    await page.locator('input[type="file"]').first().setInputFiles({ name: 'anim.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
    await expect(page.getByRole('alert').filter({ hasText: /Formato no admitido/ })).toBeVisible();
    await chooseImage(page, 'mini.png', 100);
    await expect(page.getByRole('alert').filter({ hasText: /demasiado pequeña/ })).toBeVisible();
  });

  test('F01-E6 nombre con acentos y espacios', async ({ page }) => {
    await page.goto('/crear');
    await signIn(page);
    await chooseImage(page, 'jarrón ñandú.png');
    await expect(page.getByRole('img', { name: 'Imagen de referencia subida' })).toBeVisible();
    await page.getByRole('button', { name: /^Generar/ }).click();
    await waitForModel(page);
    await expect(page.getByRole('region', { name: 'Resultado' }).getByRole('heading', { name: 'jarrón ñandú' })).toBeVisible();
  });

  test('F01-E7 móvil 390 px: sin scroll horizontal y flujo completo', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/crear');
    await signIn(page);
    await chooseImage(page);
    await expect(page.getByRole('img', { name: 'Imagen de referencia subida' })).toBeVisible();
    await page.getByRole('button', { name: /^Generar/ }).click();
    await waitForModel(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('F01-N1 la generación falla: aviso y Reintentar', async ({ page }) => {
    await page.goto('/crear');
    await signIn(page);
    await chooseImage(page, 'fallo.png');
    await expect(page.getByRole('img', { name: 'Imagen de referencia subida' })).toBeVisible();
    await page.getByRole('button', { name: /^Generar/ }).click();
    const alert = page.getByRole('region', { name: 'Resultado' }).getByRole('alert');
    await expect(alert).toContainText('no ha podido', { timeout: 30_000 });
    await expect(alert.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  });

  test('F01-N2 sesión no válida: vuelve a pedir acceso sin errores 500', async ({ page }) => {
    await page.goto('/crear');
    await signIn(page);
    await page.evaluate(() => {
      const k = 'my3dstudio:local-token';
      const s = JSON.parse(sessionStorage.getItem(k)!);
      s.token = s.token.slice(0, -4) + 'AAAA'; // firma alterada
      sessionStorage.setItem(k, JSON.stringify(s));
    });
    await page.reload();
    await chooseImage(page);
    await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('button', { name: 'Entrar' })).toBeVisible();
  });
});
