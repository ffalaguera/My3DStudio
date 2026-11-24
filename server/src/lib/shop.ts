/**
 * Catálogo de la tienda: figuras impresas en 3D de un solo color. Precios con IVA incluido, en céntimos de euro.
 * Cambiar aquí los tamaños, precios, colores y envío (la web los lee de GET /api/shop/catalog).
 */
export const SIZES = [
  { id: 's', name: 'Pequeña', heightMm: 80, priceCents: 2490 },
  { id: 'm', name: 'Mediana', heightMm: 120, priceCents: 3490 },
  { id: 'l', name: 'Grande', heightMm: 180, priceCents: 5490 },
] as const;
export type SizeId = (typeof SIZES)[number]['id'];

/** Colores de filamento en stock. `hex` es solo para la muestra de la web. */
export const COLORS = [
  { id: 'gris', name: 'Gris imprimación', hex: '#8a8d8f' },
  { id: 'hueso', name: 'Hueso', hex: '#e9e3d3' },
  { id: 'negro', name: 'Negro', hex: '#1c1b1a' },
  { id: 'rojo', name: 'Rojo', hex: '#b3262d' },
  { id: 'azul', name: 'Azul', hex: '#2f5ea8' },
  { id: 'verde', name: 'Verde', hex: '#3e7a4f' },
] as const;

export const SHIPPING_CENTS = 490;
export const SHIPPING_COUNTRIES = ['ES'] as const;
export const MAX_QUANTITY = 5;
/** Días laborables aproximados entre el pago y la entrega (impresión + envío). */
export const DELIVERY_DAYS = { min: 5, max: 8 };

export function priceOf(size: SizeId, quantity: number): { unitCents: number; shippingCents: number; totalCents: number; heightMm: number } {
  const s = SIZES.find((x) => x.id === size)!;
  return { unitCents: s.priceCents, shippingCents: SHIPPING_CENTS, totalCents: s.priceCents * quantity + SHIPPING_CENTS, heightMm: s.heightMm };
}

export const catalog = () => ({
  sizes: SIZES, colors: COLORS, shippingCents: SHIPPING_CENTS, currency: 'eur', maxQuantity: MAX_QUANTITY,
  shippingCountries: SHIPPING_COUNTRIES, deliveryDays: DELIVERY_DAYS,
});
