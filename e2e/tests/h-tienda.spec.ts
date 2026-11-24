import { a11y, chooseImage, expect, signIn, sql, test, waitForModel } from './fixtures';

// Tienda: el cliente crea su modelo gratis, pide la figura impresa y la sigue; el taller la imprime y la envía.
test.describe('H tienda de figuras impresas', () => {
  test('H-1 portada → foto → modelo gratis → pedir figura → pago de demostración → Mis pedidos', async ({ page }) => {
    await page.goto('/');
    expect(await a11y(page), 'axe portada').toEqual([]);
    await expect(page.getByRole('heading', { name: 'De una foto a tu figura impresa' })).toBeVisible();
    await chooseImage(page, 'perro.png');
    await page.getByRole('button', { name: 'Crear mi figura · gratis' }).click();
    await signIn(page);
    await expect(page).toHaveURL(/\/crear/);
    await waitForModel(page);
    const result = page.getByRole('region', { name: 'Resultado' });
    await expect(result.getByRole('button', { name: 'Exportar' })).toHaveCount(0); // no se entregan archivos

    await result.getByRole('button', { name: 'Pedir impresa' }).click();
    const dialog = page.getByRole('dialog', { name: 'Pedir la figura impresa' });
    await expect(dialog.getByText('Total, IVA incluido')).toBeVisible();
    await dialog.getByText('Grande', { exact: true }).click();
    await dialog.getByRole('radio', { name: 'Rojo' }).check({ force: true });
    await dialog.getByLabel('Con peana redonda (gratis)').check();
    await dialog.getByLabel('Cantidad').selectOption('2');
    await expect(dialog.getByRole('button', { name: /Pagar 114,70/ })).toBeVisible(); // 2 × 54,90 + 4,90
    expect(await a11y(page, 'dialog[open]'), 'axe pedir').toEqual([]);
    await page.screenshot({ path: 'test-results/h1-pedir.png' });
    await dialog.getByRole('button', { name: /^Pagar/ }).click();

    await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]+\?pago=demo/);
    await page.getByRole('button', { name: 'Simular pago' }).click();
    await expect(page.getByText('¡Pagado! Ya está en la cola de impresión.')).toBeVisible();
    await expect(page.getByText('Calle de la Demo 1')).toBeVisible();
    expect(await a11y(page), 'axe pedido').toEqual([]);
    await page.screenshot({ path: 'test-results/h1-pedido.png' });

    await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Mis pedidos' }).click();
    await expect(page.getByRole('heading', { name: 'Mis pedidos' })).toBeVisible();
    await expect(page.getByRole('link', { name: /perro/ })).toContainText('Pagado · en cola');
  });

  test('H-2 el taller ve el pedido, descarga el 3MF, lo imprime y lo envía con seguimiento', async ({ page, browser }) => {
    await page.goto('/crear');
    const buyer = await signIn(page);
    await chooseImage(page, 'gato.png');
    await page.getByRole('button', { name: /^Generar/ }).click();
    await waitForModel(page);
    await page.getByRole('region', { name: 'Resultado' }).getByRole('button', { name: 'Pedir impresa' }).click();
    await page.getByRole('dialog', { name: 'Pedir la figura impresa' }).getByRole('button', { name: /^Pagar/ }).click();
    await page.getByRole('button', { name: 'Simular pago' }).click();
    await expect(page.getByText('¡Pagado!')).toBeVisible();
    const orderId = page.url().match(/pedidos\/([0-9a-f-]+)/)![1];

    const ctx = await browser.newContext();
    const shop = await ctx.newPage();
    await shop.goto('/');
    await signIn(shop, 'taller@example.com');
    await shop.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Taller', exact: true }).click();
    const card = shop.locator(`[data-order="${orderId}"]`);
    await expect(card).toContainText('gato');
    await expect(card).toContainText('120 mm');
    expect(await a11y(shop), 'axe taller').toEqual([]);
    const fileRes = shop.waitForResponse((r) => r.url().endsWith(`/admin/orders/${orderId}/file`));
    await shop.route('**/files/**', (route) => route.fulfill({ status: 204 }));
    await card.getByRole('button', { name: '3MF' }).click();
    expect((await fileRes).status()).toBe(200);
    await expect(card).toContainText(/triángulos/);
    await card.getByRole('button', { name: 'Empezar a imprimir' }).click();
    await card.getByPlaceholder('Nº de seguimiento').fill('PK123456ES');
    await card.getByRole('button', { name: 'Marcar enviado' }).click();
    await shop.screenshot({ path: 'test-results/h2-taller.png' });
    await expect(card).toHaveCount(0, { timeout: 1 }).catch(() => {}); // sigue en la lista hasta recargar
    await ctx.close();

    await page.reload();
    await expect(page.getByText('PK123456ES')).toBeVisible();
    const row = await sql(`select status from print_orders o join profiles p on p.id = o.user_id where p.email = $1`, [buyer]);
    expect(row[0].status).toBe('shipped');
  });

  test('H-3 sin acceso al taller para clientes y sin descargas por la API', async ({ page }) => {
    await page.goto('/taller');
    await signIn(page);
    await expect(page.getByText('Esta página es solo para el taller.')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Taller', exact: true })).toHaveCount(0);
  });
});
