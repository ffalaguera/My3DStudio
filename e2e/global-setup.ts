/**
 * Freno de gasto: los e2e generan decenas de modelos. Contra el motor real (fal) cada uno cuesta dinero,
 * así que si la API en marcha no usa el motor de demostración, no se ejecuta ningún test.
 * Arranca la API de demostración: preview «clon-tripo-api-demo» o GENERATION_PROVIDER=fake.
 */
export default async function globalSetup(): Promise<void> {
  const r = await fetch('http://localhost:8787/api/capabilities').catch(() => null);
  if (!r?.ok) return; // la API la arranca webServer con su propio entorno
  const caps = (await r.json()) as { engine?: 'demo' | 'real' };
  if (caps.engine !== 'demo') {
    throw new Error(
      'La API en http://localhost:8787 usa el motor REAL de generación (de pago). Los e2e no se ejecutan contra él.\n' +
      'Para los tests, arranca la API con GENERATION_PROVIDER=fake (preview «clon-tripo-api-demo»).',
    );
  }
}
