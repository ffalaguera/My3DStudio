# Paridad: clon de Tripo Studio

Build: ea1eb0f · Fecha: 2026-11-18 · Herramientas: `parity.py` y `imgdiff.py` de replica-diff.

## Veredicto: **no se puede lanzar todavía**

| | |
| --- | --- |
| **Paridad global** | **61,4 / 100** |
| Funciones | **70,9 / 100** (44 funciones puntuadas; 6 excluidas a propósito) |
| Imprescindibles | **15 de 20** hechas, 5 parciales |
| Maquetación | 23,2 / 100 (3 pantallas) |
| Bugs abiertos | 0 (ni S1 ni S2) |

Faltan 5 imprescindibles. Ninguno es de pantalla: todos dependen del motor 3D real, de tus cuentas (Supabase, Stripe)
o de Blender en el servidor. El código para ellos está escrito y probado salvo el motor.

## Funciones por área, de la más floja a la más completa

| área | puntuación | funciones |
| --- | --- | --- |
| post-procesado | 0 | 5 (todas *could*: retopología, UV, retexturizar, rig, segmentación) |
| comunidad | 0 | 2 (*could*: galería y ficha pública) |
| legal | 50 | 1 |
| exportación | 65,4 | 5 |
| pagos | 68,2 | 4 |
| generación | 69,7 | 15 |
| cuenta | 75 | 2 |
| assets | 91,7 | 5 |
| créditos | 100 | 4 |
| visor | 100 | 1 |

## Lo que falta, en orden de construcción

**Imprescindibles (parciales)**
1. Imagen a 3D: flujo completo, pero con el motor falso.
2. Texto a 3D: igual.
3. Registro con email y Google: Supabase integrado; falta crear el proyecto y las claves.
4. Planes mensual y anual: Checkout, Portal y webhooks hechos; falta probar con tus claves de test de Stripe.
5. Exportar FBX: OBJ hecho; FBX necesita Blender en el trabajador.

**Recomendables**: multivista (no), packs de créditos (no), opciones de exportación (no), USDZ/3MF en el servidor (parcial),
prompt de textura, PBR y quads (parciales: la interfaz existe y el motor falso los ignora), licencia por plan (parcial,
faltan los términos).

**Opcionales**: subir modelo propio, galería, ficha pública con Recraft, lote, imagen de referencia, y las cinco
herramientas de post-procesado.

**Excluidas a propósito** (no puntúan): los modelos H3.1/P2.0 de Tripo, su comunidad, los plugins DCC, Agentic Canvas,
los modelos de imagen de terceros y API/CLI/app móvil.

## Maquetación

Comparación de estructura (no de color), mismo viewport (1024×768 reducido a 800×600, como las capturas del original) y
mismo estado (sin sesión, vacío). Las imágenes están en `diffs/S0x-lado-a-lado.png` (original · clon · zonas distintas en rojo).

| pantalla | puntuación | por qué difiere |
| --- | --- | --- |
| S01 inicio | 22,5 | el clon no tiene la galería bajo la caja de generación (depende de S09); en la captura del original estaba abierto el menú del espacio de trabajo |
| S03 espacio de trabajo | 32,2 | el clon tiene un panel "Actividad" fijo a la derecha y el visor en una tarjeta; en Tripo el visor ocupa todo el ancho y los assets van en un panel plegado |
| S06 mis modelos | 15,0 | el clon pone título y buscador arriba y el estado vacío en una tarjeta arriba; Tripo tiene pestañas Modelo/Imagen y el vacío centrado |

Lectura honesta: la maquetación **no se parece** y en buena parte es intencionado. La disposición exacta es parte de la
imagen de Tripo y el clon tiene que tener la suya. Lo que sí conviene acercar es lo funcional: un visor más grande
(plegar "Actividad") y una galería o ejemplos en el inicio.

## Comportamiento

| flujo | Tripo | el clon | ¿qué hacer? |
| --- | --- | --- | --- |
| F01 foto → modelo | 6 clics con registro | 5–6 clics (imagen, Generar, Google, Exportar, Descargar), y la generación arranca sola tras entrar | mantener |
| F01 fallo | "no se cobra" | además dice cuánto se devuelve y ofrece Reintentar | mantener (mejor) |
| F01 tiempos | HD "unos minutos", Smart 10–40 s | depende del motor | medir con el motor real |
| F03 topología limpia en Gratis | 2 pruebas gratis | bloqueada, con aviso de plan | **arreglar**: dar 2 pruebas (convierte mejor) |
| Ajustes de generación | "se guardan para la próxima vez" | se pierden al recargar | **arreglar** (barato) |
| Miniaturas | render del modelo | imagen de entrada; nada si es texto | **arreglar** con render en el trabajador |
| Acceso | Google, email con contraseña, X, Discord, Apple, Microsoft, Facebook | Google y enlace mágico | añadir Apple más adelante; contraseña opcional |
| Cola | posición global y prioridad por plan | posición dentro de tu cola; prioridad para los de pago | mantener |
| Exportar en Gratis | solo la versión antigua, 15 al mes | cualquier modelo, 15 al mes | mantener |
| Historial | 1 día Gratis / 7 Pro / permanente Max | igual | mantener |
| Cancelar suscripción | sin datos públicos | un clic en el Portal de Stripe | mantener |
| Emails | sin datos públicos | pago fallido y cuenta borrada | revisar en `/replica-entrepreneur` |

## Las cinco cosas que construiría ahora

1. **Motor 3D real.** Decidir (TRELLIS.2 en GPU propia o un proveedor con licencia válida en la UE), escribir el
   adaptador y medir coste y tiempo por modelo. Cierra 2 imprescindibles y desbloquea PBR, quads y prompt de textura.
2. **Tus cuentas en modo test** (Supabase en la UE, Google OAuth, Stripe) y repetir F02/F04 de punta a punta, con la
   tarjeta 4242 y la rechazada. Cierra 2 imprescindibles más.
3. **Blender en el trabajador**: FBX, USDZ y 3MF, y miniaturas renderizadas. Cierra el último imprescindible y arregla
   las tarjetas sin imagen.
4. **Recordar los ajustes de generación y 2 pruebas de topología limpia en Gratis.** Barato, y es lo que Tripo hace
   para que la gente se quede.
5. **Packs de créditos** (Checkout en modo pago). La base de datos ya tiene la bolsa que no caduca.

Con 1–3 hechos, los imprescindibles estarían 20/20 y la puntuación de funciones pasaría de 80. Entonces tocaría
`/replica-entrepreneur` para que el clon sea mejor, no solo igual.
