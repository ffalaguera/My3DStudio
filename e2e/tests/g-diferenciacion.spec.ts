import { a11y, credits, expect, signIn, test, waitForModel } from './fixtures';

// Lo que nos diferencia (replica/competencia.md): ver la imagen antes de pagar y archivos listos para imprimir.
test.describe('G diferenciación', () => {
  test('G-1 texto: ver la imagen primero sin gastar créditos, pedir otra y generar el 3D de ella', async ({ page }) => {
    await page.goto('/crear');
    await signIn(page);
    await page.getByRole('radio', { name: 'Texto' }).click();
    await page.getByLabel('Describe el objeto').fill('un búho de cerámica');
    await page.getByRole('button', { name: /Ver la imagen primero/ }).click();
    const preview = page.getByTestId('text-preview');
    await expect(preview.getByRole('img', { name: 'Imagen de referencia del texto' })).toBeVisible();
    expect(await credits(page)).toBe(100); // verla no cuesta nada
    expect(await a11y(page), 'axe vista previa').toEqual([]);
    await page.screenshot({ path: 'test-results/g1-vista-previa.png' });

    const first = await preview.getByRole('img').getAttribute('src');
    await preview.getByRole('button', { name: 'Otra imagen' }).click();
    await expect.poll(() => preview.getByRole('img').getAttribute('src')).not.toBe(first);

    // cambiar el texto descarta la imagen (ya no corresponde)
    await page.getByLabel('Describe el objeto').fill('un búho de cerámica azul');
    await expect(preview).toBeHidden();
    await page.getByRole('button', { name: /Ver la imagen primero/ }).click();
    await expect(preview).toBeVisible();

    await page.getByRole('button', { name: /^Generar 3D de esta imagen/ }).click();
    await waitForModel(page);
    expect(await credits(page)).toBe(50); // el modelo, al precio de siempre
  });

  test('G-2 exportar STL preparado para imprimir: altura, peana e informe', async ({ page }) => {
    await page.goto('/crear');
    await signIn(page);
    await page.getByRole('radio', { name: 'Texto' }).click();
    await page.getByLabel('Describe el objeto').fill('un jarrón');
    await page.getByRole('button', { name: /^Generar/ }).click();
    await waitForModel(page);
    const result = page.getByRole('region', { name: 'Resultado' });
    await result.getByRole('button', { name: 'Exportar' }).click();
    const dialog = page.getByRole('dialog', { name: 'Exportar modelo' });
    await dialog.getByText('STL', { exact: true }).click();
    const opts = dialog.getByTestId('print-options');
    await expect(opts).toBeVisible();
    await opts.getByLabel('Altura').fill('5');
    await expect(opts.getByText('Elige una altura entre 10 y 400 mm')).toBeVisible();
    await opts.getByLabel('Altura').fill('60');
    await opts.getByLabel('Añadir peana (2 mm)').check();
    expect(await a11y(page, 'dialog[open]'), 'axe exportar').toEqual([]);

    let fileUrl = '';
    await page.route('**/files/**', async (route) => {
      fileUrl = route.request().url();
      await route.fulfill({ status: 204 });
    });
    const exportRes = page.waitForResponse((r) => r.url().endsWith('/export') && r.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Descargar' }).click();
    const body = await (await exportRes).json();
    expect(body.print).toMatchObject({ heightMm: 60, base: true });
    const report = dialog.getByTestId('print-report');
    await expect(report).toContainText('62 mm'); // 60 de figura + 2 de peana
    await expect(report).toContainText(/bordes abiertos|Malla cerrada/);
    await page.screenshot({ path: 'test-results/g2-kit-impresion.png' });
    await expect.poll(() => fileUrl).toContain('model-h60-b1.stl');
    const file = await page.request.get(fileUrl);
    expect(file.status()).toBe(200);
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).last().click(); // el del pie (el ✕ también se llama Cerrar)
    await expect(dialog).toBeHidden();
  });
});
