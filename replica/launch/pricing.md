# Precios de lanzamiento de My3DStudio

## 1. La competencia (páginas públicas, leídas el 2026-11-21)

| servicio | gratis | plan de entrada | plan alto | packs | coste por modelo |
| --- | --- | --- | --- | --- | --- |
| [Tripo](https://www.tripo3d.ai/pricing) | 200 créditos/mes ≈ 13 modelos; 15 exportaciones; públicos, no comercial | Pro: 20 $/mes, 3.000 créditos ≈ 200 modelos | Max: 90 $/mes, 25.000 créditos ≈ 1.660 modelos | 10 $ = 1.000 créditos | 0,16 $ (Pro), 0,09 $ (Max) |
| [Meshy](https://www.meshy.ai/pricing) | 100 créditos/mes, hasta 10 assets; CC BY 4.0 | Pro: 19 €/mes (cartel «-50 % el primer mes»), 1.000 créditos ≈ 100 assets | Ultra: 95 €/mes, 8.000 créditos | sí (no detallado en la página) | ≈ 0,19 € (Pro) |
| [3D AI Studio](https://www.3daistudio.com/Pricing) | créditos de prueba | Basic: 1.000 créditos/mes ≈ 100 assets (precio animado, no legible) | Pro: 18.000 créditos/mes | 34 $ = 2.000 créditos, **no caducan** | ≈ 0,17 $ (packs) |

Notas:
- Tripo mostraba el mismo precio en mensual y anual con un cupón de «50 % el primer mes» activo: el precio normal
  puede ser mayor.
- Ni Meshy ni 3D AI Studio enseñan sus precios completos sin interactuar. Hay que volver a mirarlos antes de lanzar.

## 2. Lo que dicen los usuarios de Tripo (de [feedback.md](../feedback.md), 285 reseñas)

| tema | reseñas | fuentes |
| --- | --- | --- |
| Precio opaco y muros de pago | 62 | 2 |
| Cobros, cancelación y reembolsos | 46 | 2 |
| «Gratis» que no deja descargar | 38 | 2 |
| Créditos que caducan | 38 | 3 |
| Cancelar es difícil | 28 | 2 |
| Reembolsos denegados | 14 | 2 |

## 3. El modelo

- **Créditos**, como toda la categoría. **Un modelo de alto detalle = 50 créditos** (`CREDITS_HD`). La topología limpia
  cuesta 50 por variante; las texturas 4K y 8K suman 10 y 20.
- **Ninguna generación gratis** (decisión del 2026-11-21: no perder dinero). Crear la cuenta y mirar es gratis; cada
  modelo se paga antes con créditos comprados. **Sin reintentos gratis**: reintentar cuesta lo mismo que generar,
  porque cada intento es otra llamada de pago a fal. Si una generación *falla* o se cancela, los créditos se devuelven.
- **Pago por uso + 2 planes + packs.** Mensual y anual (anual = 10 meses: «pagas 10 y usas 12»).
- Los planes se nombran por quién los usa: **Pago por uso** (sin cuota, con packs), **Creador** (uso frecuente) y
  **Estudio** (volumen).

| plan | mes | año | créditos/mes | ≈ modelos | otras condiciones |
| --- | --- | --- | --- | --- | --- |
| Pago por uso | 0 € | — | 0 | lo que compres en packs | privados, comercial, topología limpia, 4K, 30 días de historial, 1 tarea a la vez |
| **Creador** | **15 €** | 150 € | 1.500 | 30 | 5 tareas, 4K, historial de 7 días |
| Estudio | 49 € | 490 € | 5.000 | 100 | 20 tareas, 8K, historial permanente |

| pack (sin caducidad) | precio | créditos | ≈ modelos | € por modelo |
| --- | --- | --- | --- | --- |
| **Prueba** | **3 €** | 150 | 3 | 1,00 |
| Pequeño | 10 € | 800 | 16 | 0,63 |
| Medio | 30 € | 2.400 + 200 de regalo | 52 | 0,58 |
| Grande | 90 € | 8.000 + 1.000 de regalo | 180 | 0,50 |

### Por qué somos más caros por modelo, y qué hacer

Tripo cobra 0,09-0,16 $ por modelo porque usa su propio modelo en sus servidores. Nosotros alquilamos TRELLIS.2 en fal
a **≈ 0,30 $ (≈ 0,28 €) por modelo**. Con ese coste no se puede igualar su precio por modelo sin perder dinero.

**No competimos en precio por modelo; competimos en lo que más odian sus usuarios:** muros de pago, créditos que se
pierden y cancelaciones imposibles. Para bajar precios más adelante, el paso es servir TRELLIS.2 en GPU propia
(Modal: ≈ 0,05 $ por modelo, ver [backend.md](../backend.md)). Entonces se podría bajar a ~20 créditos por modelo
sin tocar los precios de los planes.

### Margen si el usuario gasta todos sus créditos

El peor caso: precio sin IVA (21 %), menos comisión de Stripe (≈ 1,5 % + 0,25 € con tarjeta europea) y menos 0,28 € por
modelo.

| | ingreso neto/mes | coste motor | comisión | margen |
| --- | --- | --- | --- | --- |
| Creador mensual | 12,40 € | 8,40 € | 0,48 € | **3,52 €** |
| Creador anual | 10,33 € | 8,40 € | 0,20 € | **1,73 €** |
| Estudio mensual | 40,50 € | 28,00 € | 0,99 € | **11,51 €** |
| Estudio anual | 33,75 € | 28,00 € | 0,64 € | **5,11 €** |
| Pack de prueba 3 € | 2,48 € | 0,84 € | 0,29 € | **1,35 €** |
| Pack 10 € | 8,26 € | 4,48 € | 0,40 € | **3,38 €** |
| Cuenta sin compras | 0 € | 0 € (no puede generar) | — | **0 €** |

Lo normal es que no se gasten todos los créditos, así que el margen real será mayor. El arrastre de créditos (F2)
permite acumular **como mucho** un mes extra. Por eso el peor caso de un mes son 2 meses de créditos, compensados con el
mes en que no se usaron.

**Cómo se garantiza que no se pierde dinero:**
- **Prepago:** el servidor reserva los créditos antes de llamar a fal; sin créditos comprados no se genera.
- **Sin generaciones ni reintentos gratis:** `monthly_credits = 0` y `free_retries = 0` (migración 0004), y el reintento
  se cobra también en el código.
- **Antifraude:**
  - Checkout exige **3D Secure** (`request_three_d_secure: any`): con la verificación del banco, un fraude con tarjeta
    robada pasa a responsabilidad del banco.
  - Una **disputa** (`charge.dispute.created`) o un **aviso de fraude** (`radar.early_fraud_warning.created`) bloquea la
    cuenta y retira sus créditos.
  - Un **reembolso** (`charge.refunded`) retira los créditos de esa compra.
  - Las cuentas bloqueadas no pueden generar ni comprar.
- **Tope diario** `GENERATION_DAILY_LIMIT` (20 por defecto ≈ 5,60 €/día): pasado ese número, las tareas esperan al día
  siguiente y se registra `budget_reached` una vez al día.
- **Saldo de fal sin auto-recarga:** el gasto máximo posible es el saldo que pongas.

**Riesgos que quedan:**
- **Disputa ganada por el cliente:** Stripe cobra 20 € de comisión por disputa, más el coste de los modelos ya generados.
  Con 3D Secure las de fraude son del banco, pero las de «no lo reconozco» o «no recibido» pueden seguir llegando.
- **Coste real de texturas 4K/8K en fal:** no está medido.

## 4. Las quejas de cobro, resueltas en el producto

| queja | en My3DStudio |
| --- | --- |
| «Gratis» que no deja descargar | No hay «gratis» engañoso: crear cuenta es gratis y lo que pagas se descarga sin límite |
| Créditos que caducan | Arrastre de un mes (`renewMonthly`) + packs sin caducidad |
| Cancelar es difícil | Botón «Gestionar o cancelar suscripción» en Tu cuenta → portal de Stripe |
| Precio opaco | Coste en el botón Generar, tabla pública y aviso de 30 días en los términos |
| Reembolsos | **Pendiente** (F4: reembolso automático en 48 h sin uso) |

## 5. Lo que tienes que crear en Stripe (modo test primero)

**Productos y precios** (en EUR, IVA incluido):

| producto | precio | variable de entorno |
| --- | --- | --- |
| Pack de prueba 150 créditos | 3 € pago único | `STRIPE_PRICE_PACK_150` |
| My3DStudio Creador | 15 €/mes recurrente | `STRIPE_PRICE_PRO_MONTH` |
| My3DStudio Creador | 150 €/año recurrente | `STRIPE_PRICE_PRO_YEAR` |
| My3DStudio Estudio | 49 €/mes recurrente | `STRIPE_PRICE_MAX_MONTH` |
| My3DStudio Estudio | 490 €/año recurrente | `STRIPE_PRICE_MAX_YEAR` |
| Pack 800 créditos | 10 € pago único | `STRIPE_PRICE_PACK_800` |
| Pack 2.600 créditos | 30 € pago único | `STRIPE_PRICE_PACK_2600` |
| Pack 9.000 créditos | 90 € pago único | `STRIPE_PRICE_PACK_9000` |

Después: `npm --prefix server run seed` enlaza los ids.

**Webhook** a `/api/webhooks/stripe`, con los eventos:
- `customer.subscription.created`, `.updated` y `.deleted`;
- `invoice.paid` e `invoice.payment_failed`;
- `checkout.session.completed` (packs);
- `charge.dispute.created`, `radar.early_fraud_warning.created` y `charge.refunded` (antifraude y reembolsos).

**Portal de cliente** (Settings → Billing → Customer portal):
- Cancelación **activada**, «al final del periodo».
- **Sin** encuesta de motivo obligatoria y **sin** ofertas de retención.
- Cambio de plan entre Creador y Estudio.
- Actualizar tarjeta y ver facturas.

**Emails de Stripe** (Settings → Emails):
- Activar «recibos de pago» y «aviso de renovación próxima» (7 días antes, sobre todo para el plan anual).

**Impuestos:** `automatic_tax` está desactivado hasta tener alta fiscal. Los precios se anuncian con IVA incluido; con
Stripe Tax, configurar los precios como «inclusive».
