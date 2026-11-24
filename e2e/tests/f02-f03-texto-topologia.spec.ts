import { expect, signIn, test, waitForModel } from './fixtures';

test.describe('F02 texto → modelo 3D', () => {
  test('F02-H1 + X-2 solo con teclado: Texto, escribir, Ctrl+Enter', async ({ page }) => {
    await page.goto('/crear');
    await signIn(page);
    await page.getByRole('radio', { name: 'Texto' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Describe el objeto')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Describe el objeto')).toBeFocused();
    await page.keyboard.type('una tetera de cerámica');
    await page.keyboard.press('Control+Enter');
    await waitForModel(page);
    await expect(page.getByRole('region', { name: 'Resultado' }).getByRole('heading', { name: 'una tetera de cerámica' })).toBeVisible();
  });

  test('F02-E1 prompt vacío: aviso', async ({ page }) => {
    await page.goto('/crear');
    await signIn(page);
    await page.getByRole('radio', { name: 'Texto' }).click();
    await page.getByRole('button', { name: /^Generar/ }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Describe el objeto que quieres crear' })).toBeVisible();
  });

  test('F02-E2 texto muy largo: se corta en 1.024', async ({ page }) => {
    await page.goto('/crear');
    await signIn(page);
    await page.getByRole('radio', { name: 'Texto' }).click();
    const box = page.getByLabel('Describe el objeto');
    await box.fill('a'.repeat(1100));
    expect((await box.inputValue()).length).toBe(1024);
    await expect(page.getByText('1024 / 1024')).toBeVisible();
  });

  test('F02-E3 emoji y acentos', async ({ page }) => {
    await page.goto('/crear');
    await signIn(page);
    await page.getByRole('radio', { name: 'Texto' }).click();
    await page.getByLabel('Describe el objeto').fill('🦊 zorro de cerámica, ñ');
    await page.getByRole('button', { name: /^Generar/ }).click();
    await waitForModel(page);
    await expect(page.getByRole('region', { name: 'Resultado' }).getByRole('heading', { name: '🦊 zorro de cerámica, ñ' })).toBeVisible();
  });
});

test.describe('F03 topología limpia', () => {
  test('F03-E1 polígonos fuera de rango', async ({ page }) => {
    await page.goto('/crear');
    await signIn(page);
    await page.getByRole('radio', { name: 'Topología limpia' }).click();
    await page.getByRole('button', { name: 'Topología' }).click();
    await page.getByRole('spinbutton', { name: 'Número de polígonos' }).fill('30000');
    await expect(page.getByRole('alert').filter({ hasText: 'Elige entre 500 y 25 000 polígonos' })).toBeVisible();
  });
});
