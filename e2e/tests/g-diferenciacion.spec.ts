import { a11y, expect, signIn, test, waitForModel } from './fixtures';

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
  });

});
