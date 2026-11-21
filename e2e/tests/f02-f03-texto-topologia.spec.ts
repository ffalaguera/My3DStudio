import { a11y, credits, expect, setPlan, signIn, test, waitForModel } from './fixtures';

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

  test('F02-E1 prompt vacío: aviso y no se cobra', async ({ page }) => {
    await page.goto('/crear');
    await signIn(page);
    await page.getByRole('radio', { name: 'Texto' }).click();
    await page.getByRole('button', { name: /^Generar/ }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Describe el objeto que quieres crear' })).toBeVisible();
    expect(await credits(page)).toBe(100);
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
  test('F03-N1 plan Gratis: aviso de plan', async ({ page }) => {
    await page.goto('/crear');
    await signIn(page);
    await page.getByRole('radio', { name: 'Topología limpia' }).click();
    await page.getByRole('button', { name: /^Generar/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Esto no está en tu plan' });
    await expect(dialog).toContainText('La topología limpia está en los planes de pago');
    expect(await a11y(page, 'dialog[open]'), 'axe S13').toEqual([]);
  });

  test('F03-H1 Pro: 5.000 polígonos y 2 variantes', async ({ page }) => {
    await page.goto('/crear');
    const email = await signIn(page);
    await setPlan(email, 'pro', 3000);
    await page.reload();
    await page.getByRole('radio', { name: 'Topología limpia' }).click();
    await page.getByRole('radio', { name: 'Texto' }).click();
    await page.getByLabel('Describe el objeto').fill('un cofre de pirata');
    await page.getByRole('button', { name: 'Topología' }).click();
    await page.getByRole('spinbutton', { name: 'Número de polígonos' }).fill('5000');
    await page.getByRole('radiogroup', { name: 'Variantes' }).getByRole('radio', { name: '2' }).click();
    await expect(page.getByRole('button', { name: /^Generar.*100/ })).toBeVisible();
    await page.getByRole('button', { name: /^Generar/ }).click();
    await waitForModel(page);
    const variants = page.getByRole('region', { name: 'Resultado' }).getByRole('radiogroup', { name: 'Variantes' });
    await expect(variants.getByRole('radio')).toHaveCount(2);
    expect(await credits(page)).toBe(2900); // 3000 - 2 variantes × 50
  });

  test('F03-E1 polígonos fuera de rango', async ({ page }) => {
    await page.goto('/crear');
    const email = await signIn(page);
    await setPlan(email, 'pro', 3000);
    await page.reload();
    await page.getByRole('radio', { name: 'Topología limpia' }).click();
    await page.getByRole('button', { name: 'Topología' }).click();
    await page.getByRole('spinbutton', { name: 'Número de polígonos' }).fill('30000');
    await expect(page.getByRole('alert').filter({ hasText: 'Elige entre 500 y 25 000 polígonos' })).toBeVisible();
  });
});
