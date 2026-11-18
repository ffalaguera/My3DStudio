# Plan de pruebas: clon de Tripo Studio

Build: ea601da  Fecha: 2026-11-18  Entorno: local (web :4300 + API :8787 + Postgres embebido, motor falso, acceso local)

`auto`: **e2e** = Playwright en `clon-tripo/e2e` (navegador Edge, contra la app real con la API real) ·
**api** = Vitest en `server/test` · **manual** = pasada a mano en el navegador.
Todos los e2e fallan si hay errores de consola o respuestas 5xx, y pasan axe (WCAG 2.1 AA) en cada pantalla.

## F01 Visitante crea su primer modelo desde una imagen

| caso | tipo | pasos | esperado | auto |
| --- | --- | --- | --- | --- |
| F01-H1 | feliz | inicio → elegir imagen → Generar → entrar → esperar → Exportar GLB | arranca la generación sola, progreso, modelo en el visor, descarga GLB válida; créditos 200 → 185 | e2e |
| F01-E1 | sin sesión | en /crear subir imagen sin haber entrado | se abre el acceso; tras entrar, la imagen se sube | e2e |
| F01-E2 | doble clic | doble clic en Generar | una sola tarea, 15 créditos | e2e (+api) |
| F01-E3 | recarga a mitad | recargar durante "Generando" | la tarea sigue y termina; aparece en Actividad | e2e |
| F01-E4 | cerrar y volver | salir a Mis modelos durante la generación | el modelo aparece en Mis modelos al terminar | e2e |
| F01-E5 | archivo no válido | subir un .gif / imagen < 256 px / > 20 MB | mensaje claro en la zona de subida, no se cobra | e2e (gif, pequeña) + api (tamaño) |
| F01-E6 | nombre con acentos | subir `jarrón ñandú.png` | el modelo se llama "jarrón ñandú" | e2e |
| F01-E7 | móvil 390 px | F01-H1 a 390 px | sin scroll horizontal, todo alcanzable | e2e |
| F01-N1 | la generación falla | imagen `fallo.png` | "Ha fallado", créditos devueltos, botón Reintentar | e2e |
| F01-N2 | sesión caducada | token inválido a mitad | vuelve a pedir acceso, sin errores 500 | e2e |
| F01-N3 | sin red | API caída al pulsar Generar | mensaje "Sin conexión", nada roto | manual |

## F02 Texto a 3D

| caso | tipo | pasos | esperado | auto |
| --- | --- | --- | --- | --- |
| F02-H1 | feliz | Texto → prompt → Ctrl+Enter | modelo con el nombre del prompt | e2e (solo teclado) |
| F02-E1 | vacío | Generar sin texto | "Describe el objeto que quieres crear", no se cobra | e2e |
| F02-E2 | muy largo | 1.024 caracteres + intentar más | se corta en 1.024, contador en rojo | e2e |
| F02-E3 | emoji y acentos | "🦊 zorro de cerámica, ñ" | se acepta y el nombre se ve bien | e2e |
| F02-E4 | prompt de textura | añadir descripción de superficie | se envía; el motor falso la ignora (anotado) | manual |
| F02-N1 | contenido no permitido | — | moderación pendiente (backend.md) | — |

## F03 Topología limpia para motores de juego

| caso | tipo | pasos | esperado | auto |
| --- | --- | --- | --- | --- |
| F03-N1 | plan Gratis | elegir Topología limpia y Generar | aviso "La topología limpia está en los planes de pago" | e2e |
| F03-H1 | feliz (Pro) | Pro → Topología limpia, 5.000 polígonos, 2 variantes | 200 créditos, 2 modelos, selector de variantes | e2e (plan cambiado por API de test) |
| F03-E1 | polígonos fuera de rango | escribir 30.000 | error junto al campo, no se envía | e2e |

## F04 Sin créditos → mejorar plan

| caso | tipo | pasos | esperado | auto |
| --- | --- | --- | --- | --- |
| F04-N1 | sin saldo | saldo 10 → Generar | aviso con la cifra exacta "Te faltan 5 créditos" + Ver planes | e2e |
| F04-H1 | precios | abrir /precios | 3 planes, mensual/anual cambia los importes | e2e |
| F04-E1 | pagos sin configurar | Elegir Pro sin Stripe | aviso "Los pagos se activan pronto" | e2e |
| F04-H2 | Checkout | Elegir Pro con Stripe test, tarjeta 4242… | vuelve a /cuenta, plan Pro y 3.000 créditos | manual (necesita tus claves) |
| F04-N2 | tarjeta rechazada | tarjeta `4000 0000 0000 0002` | Stripe muestra el rechazo; plan sin cambios | manual (necesita tus claves) |
| F04-H3 | cancelar | Cuenta → Gestionar → cancelar | un clic en el Portal; vuelve a Gratis al final del periodo | manual (necesita tus claves) |

## F05 Gestionar mis modelos

| caso | tipo | pasos | esperado | auto |
| --- | --- | --- | --- | --- |
| F05-H1 | renombrar | renombrar desde el visor | nombre nuevo en visor y lista | e2e |
| F05-H2 | filtrar y buscar | chips y búsqueda; búsqueda sin resultados | lista filtrada; "Nada coincide" + Quitar filtros | e2e |
| F05-H3 | borrar | menú → Borrar → confirmar | desaparece; el foco empieza en Cancelar | e2e |
| F05-E1 | nombre largo | 60+ caracteres | se recorta con … en la tarjeta, completo en title | e2e |
| F05-E2 | dos pestañas | borrar en una pestaña, abrir en otra | "Este modelo ya no existe" | e2e |
| F05-N1 | privado en Gratis | Hacer privado | aviso de plan | e2e |
| F05-N2 | datos de otro usuario | abrir /crear?modelo=<id de otro> | "Este modelo ya no existe", nada filtrado | e2e (+api) |
| F05-N3 | límite de exportaciones | 15 exportaciones en Gratis | aviso de plan en la 16.ª | api |

## F06 Recraft desde la galería · F07 Lote

Pantallas *could* no construidas (S07, S09, lote). Sin casos hasta que existan.

## Transversales

| caso | tipo | pasos | esperado | auto |
| --- | --- | --- | --- | --- |
| X-1 | a11y | axe en S01, S03, S05, S06, S10, S12 y modales | 0 violaciones AA | e2e |
| X-2 | teclado | recorrer F02 solo con teclado | completable, foco visible | e2e |
| X-3 | cuenta | cerrar sesión; borrar cuenta | sesión fuera; tras borrar, todo eliminado y el token deja de valer | e2e (+api) |
| X-4 | zona horaria | navegador en America/New_York | fechas de caducidad y movimientos en hora local | e2e |
| X-5 | 404 | /no-existe | página "Esta página no existe" | e2e |
| X-6 | email | pago fallido y cuenta borrada | llegan desde tu dominio | manual (necesita Resend) |
| X-7 | OAuth Google real | "Continuar con Google" con Supabase | vuelve con sesión | manual (necesita tus claves) |
