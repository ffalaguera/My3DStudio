---
name: My3DStudio
description: De una foto a un modelo 3D imprimible, con el precio impreso en la tapa antes de generar.
colors:
  lid-red: "#b3262d"
  accent-hover: "#c9323a"
  on-accent: "#f8f3e6"
  lid-blue: "#2f5ea8"
  lid-mustard: "#c9962b"
  lid-green: "#3e7a4f"
  primer: "#8a8d8f"
  primer-deep: "#74777a"
  bone: "#e9e3d3"
  bone-deep: "#d9d1bd"
  ink: "#1c1b1a"
  ink-soft: "#3b3936"
  bg: "#161514"
  surface: "#1f1d1b"
  surface-2: "#282522"
  surface-3: "#34302c"
  border: "#3d3934"
  border-input: "#857e73"
  text: "#ece6d6"
  text-muted: "#b5ad9d"
  highlight: "#7ea4e4"
  highlight-surface: "#1f2b40"
  focus: "#e3bf55"
  danger: "#ff8f80"
  success: "#86c47f"
  warning: "#e6b450"
  viewport-from: "#9a9d9f"
  viewport-to: "#86898c"
typography:
  display-hero:
    fontFamily: "\"Sofia Sans Extra Condensed\", \"Arial Narrow\", sans-serif"
    fontSize: "4.75rem"
    fontWeight: 800
    lineHeight: 0.88
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "\"Sofia Sans Extra Condensed\", \"Arial Narrow\", sans-serif"
    fontSize: "3.75rem"
    fontWeight: 800
    lineHeight: 0.9
    letterSpacing: "-0.01em"
  title:
    fontFamily: "\"Sofia Sans Extra Condensed\", \"Arial Narrow\", sans-serif"
    fontSize: "1.5rem"
    fontWeight: 800
    lineHeight: 1
  lid-figure:
    fontFamily: "\"Sofia Sans Extra Condensed\", \"Arial Narrow\", sans-serif"
    fontSize: "3rem"
    fontWeight: 800
    lineHeight: 1
    fontFeature: "\"tnum\", \"lnum\""
  app-display:
    fontFamily: "\"Sofia Sans Extra Condensed\", \"Arial Narrow\", sans-serif"
    fontSize: "40px"
    fontWeight: 800
    lineHeight: "46px"
  app-title:
    fontFamily: "\"Inter Variable\", Inter, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: "34px"
  lead:
    fontFamily: "\"Inter Variable\", Inter, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "28px"
  body:
    fontFamily: "\"Inter Variable\", Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
  body-sm:
    fontFamily: "\"Inter Variable\", Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "\"Inter Variable\", Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
rounded:
  sm: "6px"
  md: "10px"
  lg: "16px"
  xl: "24px"
  pill: "999px"
  lid: "50%"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
  "16": "64px"
components:
  button-primary:
    backgroundColor: "{colors.lid-red}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.on-accent}"
  button-primary-lg:
    backgroundColor: "{colors.lid-red}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "48px"
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.bone}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "48px"
  button-ink-hover:
    backgroundColor: "{colors.ink-soft}"
  button-secondary:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "40px"
  button-ghost:
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "40px"
  button-ghost-hover:
    backgroundColor: "{colors.surface-3}"
  pot-lid:
    backgroundColor: "{colors.lid-red}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.lid}"
    size: "80px"
  pot-lid-mustard:
    backgroundColor: "{colors.lid-mustard}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lid}"
  pot-lid-blue:
    backgroundColor: "{colors.lid-blue}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.lid}"
  pot-lid-green:
    backgroundColor: "{colors.lid-green}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.lid}"
  segmented-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.bone}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px"
  segmented-ink-selected:
    backgroundColor: "{colors.bone}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "32px"
  chip:
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "32px"
  chip-selected:
    backgroundColor: "{colors.highlight-surface}"
    textColor: "{colors.text}"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
  panel:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
  nav-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.pill}"
    height: "48px"
---

# Design System: My3DStudio

## Overview

**Creative North Star: "La guía de pintado"**

Generar un modelo se lee como pintar una miniatura: foto, malla en gris de imprimación, textura terminada y archivo imprimible, con el precio impreso en la tapa del bote. El sistema rechaza el tópico de la categoría (un render brillante flotando sobre negro bajo un titular centrado) y lo sustituye por materiales de taller: grandes campos de gris imprimación mate, páginas de papel hueso como las de un manual de pintado, tinta casi negra para el texto y las líneas guía, y botes de pintura de tapa redonda y saturada como único lenguaje de componente con carácter.

Hay dos modos sobre los mismos tokens. Las páginas que persuaden (portada y precios) alternan bandas de imprimación, hueso y tinta a sangre completa, con titulares condensados en mayúsculas y botes grandes que llevan pasos, planes y packs. Las pantallas de trabajo (taller, mis modelos, cuenta) viven en un esquema oscuro de tinta cálida, con contención: superficies escalonadas por tono, Inter en tamaños de panel, y la tapa roja reservada para la acción que cuesta créditos. La densidad es de herramienta, no de folleto.

Las cifras son protagonistas porque son la promesa del producto: créditos, euros, milímetros y polígonos se componen siempre en cifras tabulares, y en el visor se nombran con etiquetas de línea guía como en una lámina técnica. La prueba es siempre real: modelos generados con el motor de producción (fal TRELLIS.2) y la interfaz de verdad.

**Key Characteristics:**
- Gris imprimación, hueso y tinta como suelos de página; tinta cálida oscura para la app.
- El bote de pintura (tapa circular saturada con etiqueta impresa) agrupa pasos, planes y packs.
- Rojo de tapa como color de acción; el resto de tapas (azul, ocre, verde) son color de función, no de acción.
- Voz condensada en mayúsculas para titular; Inter sobria para trabajar.
- Cifras tabulares y líneas guía para todo dato medible.
- Movimiento físico: órbita con inercia, tapas que se hunden al pulsar, una sola entrada orquestada (las tapas se asientan una tras otra y el modelo pasa de imprimación a textura).

## Colors

Una paleta de taller: neutros mate con temperatura (gris imprimación frío, hueso y tinta cálidos) y cuatro tapas de pintura saturadas que funcionan como color de función.

### Primary
- **Rojo de tapa** (lid-red): el color de la acción que cuesta créditos y del primer bote. Rellena el botón Generar, «Elegir plan», «Crear mi primer modelo», el bote 1 de la portada (la zona de subida) y el monograma del logotipo. Es el token `accent` de la app: mismo valor, dos nombres según el contexto.
- **Rojo de tapa encendido** (accent-hover): solo el estado hover del botón primario.
- **Crema sobre tapa** (on-accent): texto e iconos sobre rojo, azul y verde.

### Secondary
- **Azul de tapa** (lid-blue): bote «Textura», plan Creador y pack de 2.600 créditos. Lleva texto crema.
- **Ocre mostaza** (lid-mustard): bote «Malla gris», tapa del Pack de 800 créditos, anillo hover de miniaturas y fondo de la selección de texto. Es un ocre terroso, no un amarillo de señal; lleva texto en tinta.
- **Verde de tapa** (lid-green): bote «Archivo», plan Estudio y pack de 9.000 créditos. Lleva texto crema.

### Tertiary
- **Azul de selección** (highlight) y **fondo de selección** (highlight-surface): estado seleccionado de chips y opciones en la app oscura. Nunca rellena acciones.

### Neutral
- **Gris imprimación** (primer): suelo de la primera vista y de las bandas de precio; también la tapa neutra (`data-lid="primer"`) y el fondo de miniaturas redondas. Texto en tinta.
- **Imprimación honda** (primer-deep): esqueletos de carga y la sombra del disco en el visor mientras carga.
- **Papel hueso** (bone): páginas de guía (cómo se pinta, preguntas), el tablero de planes, la cartela «Salió de esta frase» y el texto sobre tinta.
- **Hueso tostado** (bone-deep): variante de papel con más cuerpo; contraste validado con tinta.
- **Tinta** (ink): texto y líneas guía sobre imprimación y hueso; bandas de tinta (promesas, cierre, tus últimos modelos); la peana del visor 3D; botones secundarios en páginas de persuasión.
- **Tinta suave** (ink-soft): hover de los botones de tinta.
- **Fondo de taller** (bg), **superficie** (surface), **superficie 2** (surface-2), **superficie 3** (surface-3): la escalera tonal de la app oscura, de lienzo a panel a control elevado.
- **Borde** (border) y **borde de campo** (border-input): divisiones de panel y el trazo de campos, que llega a 3:1 sobre el fondo.
- **Texto** (text) y **texto apagado** (text-muted): texto de la app oscura; el cálido apagado sustituye al gris frío.
- **Foco ámbar** (focus): anillo de foco y caret de campos. Solo foco.
- **Peligro** (danger), **éxito** (success), **aviso** (warning): estados en la app oscura, validados contra surface-2.
- **Campo del visor** (viewport-from → viewport-to): degradado radial suave en gris imprimación del visor de la app, con texto en tinta; el visor de la app se apoya en el mismo campo que la portada.

### Named Rules
**La Regla de la Tapa Roja.** El rojo de tapa rellena solo la acción principal de cada vista (normalmente la que gasta créditos o paga). Si una vista tiene dos rellenos rojos que compiten, uno de ellos sobra.

**La Regla del Color de Función.** Azul, ocre y verde de tapa identifican pasos, planes y packs. El color de cada producto es fijo por su id (`web/src/app/data/lids.ts`: free y pack_150 rojo, pack_800 ocre, pro y pack_2600 azul, max y pack_9000 verde) y es el mismo en portada y precios; nunca se asigna por posición. No se usan como color de botón ni de enlace.

**La Regla del Contraste Medido.** Toda pareja de texto o borde nueva se añade a `pairs` en `replica/design/tokens.json` y pasa `contrast.py` (hoy 36 parejas, 0 fallos AA) antes de usarse. Los tokens se cambian en `tokens.json` y se regeneran con `build-tokens.mjs`; nunca hex ni px de diseño en las hojas de estilo.

## Typography

**Display Font:** Sofia Sans Extra Condensed, variable 400–900, autoalojada en `web/public/fonts` (OFL) (con Arial Narrow, sans-serif)
**Body Font:** Inter Variable (con Inter, system-ui, -apple-system, Segoe UI, Roboto)
**Label/Mono Font:** JetBrains Mono solo en contextos técnicos de la app; las cifras usan Inter o Sofia con `tabular-nums lining-nums`.

**Character:** La condensada pone la voz de una guía de pintado: mayúsculas apretadas, peso 800, interlineado por debajo de 1, que titulan como el rótulo de un bote. Inter trabaja debajo sin pedir atención.

### Hierarchy
- **Display hero** (800, 52px en móvil / 76px desde sm, interlineado 0.88, mayúsculas): el h1 de portada y precios, arriba a la izquierda, nunca centrado.
- **Headline** (800, 48px / 60px desde sm, interlineado 0.9, mayúsculas): el h2 de cada banda de imprimación, hueso o tinta. Aplicado por regla base a todo h2 dentro de `.ground-*`.
- **Title** (800, 24px, interlineado 1, mayúsculas, condensada): etiquetas de bote, renglones de «Contenido del bote» (22px), preguntas de taller, nombres de plan (36px) y cifras del visor; los pasos de la guía suben a 30px.
- **Lid figure** (800, 48px, cifras tabulares): el precio o número impreso en una tapa (32px en planes, 30–36px en botes de paso).
- **App display / App title** (40/46 condensada; 28/34 Inter 700): títulos de página en la app oscura. Todo h1 que no sea `text-xs`/`text-sm` toma la condensada.
- **Lead** (600, 20/28): subtítulos de panel en la app.
- **Body** (400, 16/24) y **Body sm** (400, 14/20): texto corrido; párrafos de banda limitados a 34–60ch.
- **Label** (500, 12/16): pistas, cartelas, chips, etiquetas de dato. El rótulo de sección de panel en la app usa label en mayúsculas con tracking amplio.

### Named Rules
**La Regla de la Voz Condensada.** La condensada titula y rotula cifras; nunca compone párrafos ni etiquetas de formulario. Si un texto tiene más de una línea de lectura, va en Inter.

**La Regla de las Cifras Tabulares.** Créditos, euros, milímetros y polígonos llevan siempre la clase de cifras tabulares, sea cual sea la familia.

## Layout

Módulo estricto de 8px sobre la escala de Tailwind (4, 8, 12, 16, 20, 24, 32, 48, 64px); los medios pasos (4, 12, 20) solo dentro de controles.

Páginas de persuasión: bandas a sangre completa que alternan suelo (imprimación → tinta → hueso → tinta → imprimación → hueso → tinta en portada), contenido en un contenedor de 80rem (1280px) con márgenes de 16px en móvil y 32px desde sm, rejilla de 12 columnas desde lg con titular en 4–5 columnas y contenido en 7–8. Ritmo vertical de banda: 64px en móvil, 96px desde sm. La primera vista coloca el titular arriba a la izquierda (5 columnas), el visor a la derecha (7 columnas, alto `min(68svh, 38rem)`) y los botes debajo del titular; en móvil el visor baja justo bajo el titular (224px de alto) y los ejemplos se desplazan en horizontal. La banda superior se mete bajo la barra flotante (−60px) para que la imprimación llegue al borde.

App: barra flotante de 48px separada 12px del borde, carril de herramientas de 64px, panel de herramientas de 288px, panel lateral de 320px y contenido hasta 1440px. Puntos de corte: sm 640, md 768, lg 1024, xl 1280.

**La Regla de las Líneas de Lámina.** Las divisiones de contenido en páginas de persuasión son filetes de tinta de 2px (`keyline`, tinta al 85%; 1px entre renglones de una misma lista) o de hueso al 30–40% sobre tinta, nunca tarjetas con borde. Las listas se apilan como renglones de un manual.

## Elevation & Depth

Sistema híbrido. Las páginas de persuasión son planas por bandas y la profundidad la dan los objetos físicos: la tapa del bote (color plano impreso, canto oscurecido y sombra baja, sin relieve fingido), el tablero de planes en hueso, que se levanta sobre la imprimación como una hoja sobre la mesa, y la etiqueta «Contenido del bote», una hoja hueso sobre la banda de tinta. La app oscura separa por escalera tonal (bg → surface → surface-2 → surface-3) y reserva la sombra para lo que flota: barra de navegación, menús, modales y avisos. El 3D del visor tiene su propia luz cálida (clave 0xfff6e6, hemisférica hueso/tinta) y proyecta sombra sobre una peana de tinta.

### Shadow Vocabulary
- **Card** (`box-shadow: 0 1px 2px rgba(0,0,0,.4)`): asiento mínimo de tarjetas en la app.
- **Float** (`box-shadow: 0 8px 24px rgba(0,0,0,.45)`): barra de navegación flotante y avisos.
- **Pop** (`box-shadow: 0 16px 40px rgba(0,0,0,.55)`): menús y modales.
- **Tapa en reposo** (`box-shadow: 0 4px 10px rgb(0 0 0 / 0.22)`): cada bote.
- **Tapa pulsada** (`box-shadow: 0 1px 3px rgb(0 0 0 / 0.28)` con `translateY(2px)`): bote pulsado o activo.
- **Hoja sobre la mesa** (`box-shadow: 0 12px 32px rgb(0 0 0 / 0.22)` sobre imprimación, `0 12px 32px rgb(0 0 0 / 0.35)` sobre tinta): tablero de planes y etiqueta «Contenido del bote».

### Named Rules
**La Regla del Objeto Físico.** En las páginas de persuasión solo proyectan sombra los objetos que existirían en un taller (tapas, la hoja de planes, la etiqueta del bote, la cartela). Los bloques de texto no flotan.

## Shapes

Tres formas y nada más. El círculo pertenece a la tapa del bote, a las miniaturas de «Tus últimos modelos», a la peana del visor y al monograma; un círculo siempre significa «bote» u «objeto». La píldora (999px) es la forma de todo control pulsable: botones, segmentados, chips, insignias y la barra de navegación. Las bandas, los filetes y las páginas de hueso son rectángulos a sangre, sin esquina redondeada. En la app, los contenedores redondean suave: campos 10px, tarjetas y paneles 16px, modales 24px, elementos de menú 10px.

## Components

### Buttons
Táctiles y contundentes: píldoras que se hunden 1px y encogen al 98% al pulsar.
- **Shape:** píldora completa (999px); alturas de 32, 40 y 48px.
- **Primary:** rojo de tapa con texto crema en semibold, 40px de alto y 20px de padding horizontal (48px y 24px en la variante grande). Lleva el coste dentro cuando la acción gasta créditos: «Generar · 50 créditos».
- **Hover / Focus:** hover al rojo encendido en 120ms; foco con anillo ámbar de 2px separado 2px. Deshabilitado al 40% de opacidad con cursor prohibido.
- **Tinta (persuasión):** fondo tinta con texto hueso y hover a tinta suave; es el secundario sobre imprimación y hueso («Ver todos los precios», «Comprar», «Crear cuenta»). El plan actual es tinta al 10% con borde de tinta de 2px.
- **Secondary / Ghost / Danger (app):** secundario en surface-3 con borde que se aclara al pasar; fantasma sin fondo que toma surface-3 al pasar; peligro con borde y texto rojo claro.

### Chips
- **Style:** píldora de 32px, borde de 1px, texto apagado en label.
- **State:** seleccionado (`aria-pressed`/`aria-checked`) con borde y fondo de selección azul y texto claro. En persuasión, los selectores de ejemplo son píldoras con borde de tinta de 2px que se rellenan de tinta al seleccionarse.

### Segmentado
- **App:** carril surface con 4px de padding; la opción activa sube a surface-3, o a rojo de tapa en la variante de acento.
- **Persuasión:** carril de tinta al 90% con texto hueso; la opción activa se invierte a hueso con texto tinta («Alto detalle / Topología limpia», «Mensual / Anual»).

### Cards / Containers
- **Corner Style:** 16px en tarjetas y paneles de app; ninguno en bandas.
- **Background:** surface (tarjeta) y surface-2 con borde (panel).
- **Shadow Strategy:** tonal; card como mucho (ver Elevation & Depth).
- **Border:** 1px border en paneles.
- **Internal Padding:** 16–24px.

### Inputs / Fields
- **Style:** surface con trazo border-input de 1px, radio 10px, texto 14px, placeholder apagado.
- **Focus:** el trazo pasa a ámbar de foco; caret ámbar.
- **Error / Disabled:** trazo rojo claro con `aria-invalid`, texto de error de 12px en danger.

### Navigation
Barra flotante en píldora a 12px del borde, superficie al 90% con desenfoque, borde y sombra float, 48px de alto. Monograma circular rojo «3D» con el nombre al lado desde sm; botón «Crear» secundario con menú; enlaces en 14px apagados que, activos, pasan a texto claro con subrayado inferior de 2px. En móvil los enlaces se pliegan en una hoja panel bajo la barra. Créditos disponibles visibles con icono y cifra.

### Bote de pintura (signature)
El componente que define el mundo. Una tapa impresa: círculo de color plano, canto de 3px en el mismo tono oscurecido (`color-mix(in srgb, <tapa> 72%, black)`) y sombra baja, sin brillo ni bisel; dentro, un número o un precio en la condensada con cifras tabulares, y debajo, la etiqueta impresa en title. Tamaños de 56 a 160px (80px en los pasos 2–4, 112/160px en la zona de subida, 128–144px en precios). El color lo fija `data-lid` (rojo por defecto; mustard y primer llevan texto en tinta); en planes y packs sale del id del producto. Al pulsar o al estar activo se hunde 2px con curva `cubic-bezier(0.16, 1, 0.3, 1)` en 120ms; el paso elegido lleva además un contorno de tinta de 3px separado 3px. Entrada: en la primera vista de la portada las tapas bajan y se asientan una tras otra (`lid-press`, 560ms, misma curva, 60ms de escalonado por orden), y nada más entra animado; con `prefers-reduced-motion` no hay entrada. En precios, con facturación anual la tapa del plan muestra el total al año («al año»), no un mensual prorrateado. El bote 1 es una zona de subida real: acepta arrastrar, pegar o clic y muestra la foto dentro de la tapa con un anillo hueso.

### Visor de pintado (signature)
Visor three.js sobre la imprimación, con el modelo sobre una peana de tinta y órbita con inercia (amortiguación 0.06, giro automático lento que se reanuda a los 3s y se desactiva con `prefers-reduced-motion`; flechas del teclado para girar). El primer modelo se pinta en imprimación y a los 650ms se repinta con su textura. Cada bote lo repinta: «Foto» muestra la cartela hueso con la frase de origen, «Malla gris» pinta imprimación mate, «Textura» el acabado, y «Archivo» dibuja tres líneas guía de tinta de 1.25px con punto final de 3.5px hacia etiquetas de alto, ancho × fondo (mm) y polígonos en cifras tabulares, cada una sobre una placa hueso al 90% con filete de tinta, con fundido de 320ms.

### Contenido del bote
La lista de garantías se compone como la etiqueta de un bote: una hoja hueso sobre la banda de tinta, con cabecera condensada («Contenido del bote» y el recuento en cifras tabulares) sobre un filete de tinta de 2px, y renglones separados por filetes de tinta de 1px: título condensado en mayúsculas a la izquierda y texto en Inter 14px a la derecha. Sin iconos.

## Do's and Don'ts

### Do:
- **Do** usar los suelos de página (`ground-primer`, `ground-bone`, `ground-ink`) a sangre completa para las páginas que persuaden, alternándolos por banda.
- **Do** imprimir el coste dentro de la acción («Generar · 50 créditos») o en la tapa del bote, siempre antes de que la acción ocurra.
- **Do** dar a cada producto su color de tapa fijo desde `web/src/app/data/lids.ts`, igual en portada y precios; los pasos de la guía son Foto rojo, Malla gris ocre, Textura azul, Archivo verde.
- **Do** componer créditos, euros, milímetros y polígonos con cifras tabulares.
- **Do** cambiar colores, tipos, espacios y sombras en `replica/design/tokens.json`, regenerar con `build-tokens.mjs` y pasar `contrast.py` sin fallos AA.
- **Do** mostrar solo modelos reales generados con el motor de producción, con su procedencia en `web/public/showcase/provenance.json`, rotulados como ejemplos hechos con My3DStudio.
- **Do** respetar `prefers-reduced-motion`: sin giro automático y sin entradas animadas.

### Don't:
- **Don't** usar un amarillo saturado de señal como color de acción o de campo grande: es el color del competidor. El ocre mostaza de tapa y el ámbar de foco son los únicos cálidos amarillentos, y nunca rellenan un botón.
- **Don't** presentar el modelo como un render brillante flotando sobre negro bajo un titular centrado.
- **Don't** usar los colores de tapa azul, ocre o verde para botones o enlaces; son color de función.
- **Don't** meter tarjetas con borde en las páginas de persuasión; se separa con filetes de tinta.
- **Don't** componer párrafos en la condensada ni usar Inter para los titulares de banda.
- **Don't** usar un círculo para algo que no sea un bote, un objeto o el monograma.
- **Don't** inventar testimonios, cifras de usuarios, valoraciones ni logotipos de clientes como prueba visual.
