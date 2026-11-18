# Bugs: clon de Tripo Studio

Build probado: ea601da → arreglos en d03383f. Fecha: 2026-11-18. Navegador: Edge (Playwright), 1440 px y 390 px.
Solo bugs reproducidos. Abiertos: **0**. Por severidad: S1 1 · S2 4 · S3 4 · S4 1 (todos arreglados, con test).

### BUG-006: doble clic en Generar crea dos tareas y cobra dos veces

- Severity: S1 (cobro duplicado)
- Flow / case: F01 / F01-E2
- Screen: S03
- Build: tras el arreglo de BUG-002 (sin commit intermedio)  Browser / device: Edge, 1440 px

Steps
1. Entrar, subir una imagen en /crear.
2. Doble clic en "Generar".

Expected: una tarea, 15 créditos reservados.
Actual: dos tareas, 30 créditos.
Evidence: e2e `F01-E2 doble clic en Generar crea una sola tarea` (Expected 1, Received 2).
Suspected cause: regresión introducida al arreglar BUG-002: la consulta del plan (`await estimate`) iba antes de bloquear
el botón, y el segundo clic pasaba la comprobación. El servidor ya es idempotente por `Idempotency-Key`, pero cada clic
generaba una clave nueva.
Status: fixed in d03383f (el bloqueo es la primera instrucción de `generate()`)

### BUG-001: un emoji o un carácter fuera de Latin-1 en el texto da error 500

- Severity: S2
- Flow / case: F02 / F02-E3
- Screen: S03
- Build: ea601da  Browser / device: Edge, 1440 px

Steps
1. Texto → "🦊 zorro de cerámica, ñ" → Generar.

Expected: se crea la tarea y el modelo se llama igual.
Actual: 500 "Algo ha fallado". Log: `character with byte sequence 0xf0 0x9f 0xa6 0x8a in encoding "UTF8" has no equivalent in encoding "WIN1252"`.
Evidence: e2e `F02-E3`, test de API `BUG-001 emoji y caracteres fuera de Latin-1` (rojo antes del arreglo).
Suspected cause: el Postgres embebido de desarrollo y tests se inicializaba con la codificación de Windows. Supabase usa
UTF-8, así que en producción no pasaría, pero en local escondía errores.
Status: fixed in d03383f (initdb `--encoding=UTF8 --locale=C` y la migración se niega a arrancar si la base no es UTF8).
La base local de desarrollo se recreó (solo tenía datos de prueba) y se volvió a cargar el seed.

### BUG-005: el límite de peticiones al crear tareas no limitaba nada

- Severity: S2 (seguridad: abuso de la cola y de la GPU)
- Flow / case: transversal / lista de seguridad
- Screen: API `POST /api/tasks`
- Build: ea601da

Steps
1. Enviar 31 `POST /api/tasks` en menos de un minuto con el mismo usuario.

Expected: la 31 recibe 429.
Actual: las 31 pasan.
Evidence: test `BUG-005 crear tareas: la petición 31 en un minuto recibe 429` (rojo antes del arreglo).
Suspected cause: el limitador se creaba dentro del middleware, así que cada petición tenía un contador nuevo.
Status: fixed in d03383f

### BUG-007: después de entrar desde el inicio, la app vuelve a pedir el acceso y no genera

- Severity: S2 (el flujo principal F01 se queda parado; se puede seguir entrando otra vez)
- Flow / case: F01 / F01-H1
- Screen: S01 → S02 → S03
- Build: ea601da (solo con la API real)

Steps
1. Sin sesión, en el inicio elegir una imagen y pulsar Generar.
2. Entrar en el modal de acceso.

Expected: la imagen se sube y la generación arranca.
Actual: la imagen se sube y el modal de acceso se abre otra vez; no arranca nada.
Evidence: captura de e2e `F01-H1` (modal abierto con la sesión ya iniciada, 200 créditos en la barra).
Suspected cause: "¿hay sesión?" se miraba con el perfil (`/me`), que con la API real llega después que la sesión.
Con la API falsa era instantáneo.
Status: fixed in d03383f (`Gates.ensureSignedIn` usa la sesión)

### BUG-002: en el plan Gratis, el aviso de "topología limpia es de pago" llega después de pedir la imagen

- Severity: S3
- Flow / case: F03 / F03-N1
- Screen: S03
- Build: ea601da

Steps
1. Plan Gratis, elegir "Topología limpia", sin imagen, pulsar Generar.

Expected: aviso de plan.
Actual: "Sube una imagen para generar"; el aviso de plan solo sale después de subirla.
Evidence: e2e `F03-N1`, captura.
Status: fixed in d03383f

### BUG-003: el visor vacío se puede enfocar con el teclado pero está oculto a los lectores de pantalla

- Severity: S3 (accesibilidad, WCAG 4.1.2)
- Flow / case: X-1
- Screen: S03
- Build: ea601da

Steps
1. Abrir /crear sin modelo y recorrer con Tab.

Expected: el visor solo es enfocable cuando hay un modelo.
Actual: el foco cae en un elemento con `aria-hidden="true"` (axe `aria-hidden-focus`); además el foco no se veía (`outline-none`).
Evidence: e2e `X-1` (axe).
Status: fixed in d03383f (tabindex y role solo con modelo; anillo de foco visible)

### BUG-008: la barra de progreso no tiene nombre y lleva el botón Cancelar dentro

- Severity: S3 (accesibilidad)
- Flow / case: F01 / F01-H1
- Screen: S04
- Build: ea601da

Steps
1. Generar y, mientras está en cola o generando, pasar axe.

Expected: barra con nombre accesible y sin controles dentro.
Actual: axe `aria-progressbar-name` y `nested-interactive`.
Evidence: e2e `F01-H1` (axe S04).
Status: fixed in d03383f

### BUG-004: el coste dentro del botón Generar no llega al contraste mínimo

- Severity: S4 (visual / accesibilidad)
- Flow / case: X-1
- Screen: S03
- Build: ea601da

Steps
1. Abrir /crear y pasar axe.

Expected: contraste AA.
Actual: axe `color-contrast` en el texto del coste (opacidad 0,8 sobre el botón).
Evidence: e2e `X-1`.
Status: fixed in d03383f (sin opacidad; se diferencia por peso de letra)

### BUG-009: los modelos reales de fal fallaban al guardarse (EXT_texture_webp)

- Severity: S2 (con el motor real, ninguna generación con textura llegaba al usuario; fal la cobraba igual)
- Flow / case: F01 / prueba real con fal
- Build: 45b5271

Steps
1. `GENERATION_PROVIDER=fal`, generar desde una imagen.

Expected: el modelo se guarda.
Actual: al 90 % "Ha fallado la generación"; log: `Missing required extension, "EXT_texture_webp"`.
Evidence: test `BUG-009 GLB con EXT_texture_webp` (rojo antes del arreglo).
Suspected cause: el servidor leía los GLB sin registrar extensiones de glTF; el fal simulado de los tests devolvía GLB sin texturas.
Status: fixed in 145aced (lector de glTF compartido con todas las extensiones: `server/src/lib/gltf.ts`)

### BUG-010: al abrir el enlace de un modelo sin sesión y entrar, seguía diciendo "Inicia sesión"

- Severity: S3 (se arreglaba recargando)
- Flow / case: F05
- Screen: S05

Steps
1. Sin sesión, abrir `/crear?modelo=<id propio>`.
2. Entrar.

Expected: el modelo se carga.
Actual: "Inicia sesión para continuar" hasta recargar la página.
Evidence: e2e `BUG-010 abrir el enlace de un modelo sin sesión y entrar` (rojo sin el arreglo, verde con él).
Status: fixed in 145aced (la carga del modelo se repite al cambiar la sesión)

## También corregido en las pruebas reales con fal

- Clave rechazada (401) y cuenta sin saldo (403) se mostraban al usuario como "rechaza la clave (FAL_KEY)". Ahora el
  usuario ve un mensaje genérico y el log dice cuál de los dos es (45b5271).
- "Topología limpia" pedía la mitad de polígonos: `decimation_target` cuenta caras, no vértices (145aced).

## También corregido (menor, sin número)

- Acceso local: con demasiados intentos decía "No se ha podido entrar"; ahora explica que hay que esperar un minuto.
- El límite del acceso local (solo desarrollo) sube de 10 a 60 por minuto para no bloquear los e2e.

## Problemas del entorno de pruebas (no son bugs de la app)

- El servidor de desarrollo de la web dejó de recompilar tras `npm audit fix` (cambió `node_modules` en caliente) y los
  e2e corrieron contra un paquete viejo. Solución: reiniciarlo y borrar `.angular/cache`.
- Las descargas reales de Edge dejan una promesa rechazada en Playwright al cerrar la página, que hace fallar el test
  siguiente. El e2e de exportar intercepta el archivo y comprueba sus bytes (`glTF`); la descarga real se probó a mano.

## Por comprobar (no reproducido o sin poder probar)

- Checkout, tarjeta rechazada (`4000 0000 0000 0002`) y Portal de Stripe: necesitan tus claves de test.
- Google OAuth y enlace mágico reales con Supabase: necesitan el proyecto.
- Emails de pago fallido y de cuenta borrada con Resend: necesitan el dominio.
- Dos pestañas generando a la vez con la misma sesión: cubierto por el test de API de concurrencia (20 peticiones), no
  por un e2e.
