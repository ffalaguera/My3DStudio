# Build log: clon de Tripo Studio

App en `clon-tripo/web` (Angular 21 + Tailwind 3 con el preset de `replica/design`, three.js, Lucide).
Datos: `FakeApi` en el navegador con las mismas firmas que la API de `architecture.md`
(`src/app/data/api.ts`). `/replica-backend` la sustituye por `HttpApi` sin tocar pantallas.
Nombre provisional del producto: "Forma" (`shell/title.ts`), hasta `/replica-brand`.

Arranque: `npm --prefix clon-tripo/web start -- --port 4300` (o la configuración `clon-tripo-web` de `.claude/launch.json`).
Para probar el estado de error: un prompt o un archivo cuyo nombre contenga "fallo" hace fallar la tarea al 30 %.

| ID | fecha | estado | qué falta | más difícil de lo previsto |
| --- | --- | --- | --- | --- |
| shell | 2026-11-18 | hecho | – | `lucide-angular` no admite Angular 21: componente de icono propio con un registro de iconos usados (`ui/icons.ts`) |
| S01 inicio | 2026-11-18 | hecho | galería de ejemplos (depende de S09) | – |
| S02 acceso | 2026-11-18 | parcial | Google y enlace por email reales (Supabase Auth); Apple/Microsoft/Discord | – |
| S03 configurar | 2026-11-18 | hecho | multivista y lote; ajustes en desplegable dentro del panel en vez de popover flotante (más accesible) | – |
| S04 generando | 2026-11-18 | hecho | progreso por SSE real | – |
| S05 resultado | 2026-11-18 | hecho | herramientas de post-procesado del carril (Piezas, Retopo, UV, Textura, Rig) están deshabilitadas | – |
| S06 mis modelos | 2026-11-18 | hecho | renombrar desde la tarjeta (sí desde el visor), "Collected" | – |
| S07 ficha pública | – | pendiente (could) | todo; hay una página provisional | – |
| S08 exportar | 2026-11-18 | parcial | FBX y 3MF (conversión en servidor), opción "incluir texturas" | – |
| S09 galería | – | pendiente (could) | todo; página provisional | – |
| S10 precios | 2026-11-18 | hecho | packs de créditos; tabla comparativa completa; precios provisionales | – |
| S11 pago | 2026-11-18 | parcial | Stripe Checkout; ahora es una confirmación de "pago simulado" sin cobro | – |
| S12 cuenta | 2026-11-18 | hecho | portal de facturación de Stripe | el gasto confirmado se mostraba como un segundo descuento; ahora sale como "N confirmados" |
| S13 aviso de plan | 2026-11-18 | hecho | – | – |

## Verificado en el navegador (1440 px y 390 px)

- F01: inicio → imagen → Generar → arranca sola en S03 → progreso → modelo en el visor → exportar.
- Exportaciones reales: GLB (cabecera `glTF`), OBJ, STL binario y USDZ (zip). FBX/3MF deshabilitados con aviso.
- Créditos: 185 → 155 con dos tareas reservadas → 170 al cancelar la que estaba en cola → 185 cuando falla la otra.
- Concurrencia del plan Gratis (1): la segunda tarea queda "En cola".
- Avisos de plan: topología limpia en Gratis, privado en Gratis, límite de exportaciones.
- Cambio a Pro (pago simulado): 3.000 créditos, topología limpia con 2 variantes (200 créditos), historial de 7 días.
- Mis modelos: filtros, búsqueda sin resultados, borrar con confirmación (foco en "Cancelar").
- Teclado: orden de tabulación lógico; texto a 3D completo con Tab, Enter y Ctrl+Enter.
- Sin scroll horizontal a 390 px en ninguna ruta. Sin errores de consola.
- `ng build` de producción: 375 kB iniciales, sin avisos de presupuesto (three.js se carga bajo demanda).

## Fallos encontrados y corregidos durante la construcción

- La forma "cristal" en alto detalle tenía 720 caras (subdivisión mal calculada).
- La API falsa ignoraba la visibilidad elegida y ponía "privado" en los planes de pago.
- El paquete inicial pesaba 1,29 MB (three.js y todos los iconos de Lucide entraban al arrancar).

## Pendiente conocido

- Los grupos de opciones (`role="radiogroup"`) se recorren con Tab y no con flechas como pide `components.md`.
- Inter va autoalojada; JetBrains Mono no se usa aún.
- Capturas para `/replica-diff`: S01, S03, S06 y S10 a 1440×900 sin sesión; S04, S05 y S06 con modelos solo en
  resolución reducida (tomadas en el panel del navegador).
- No hay tests automáticos todavía (`/replica-test`).
