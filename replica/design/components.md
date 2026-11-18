# Componentes del clon de Tripo Studio

Fuente: lista de componentes de `replica/recon.md` y capturas de `replica/screens/`.
Tokens: `tokens.json` → `tokens.css` + `tailwind.preset.cjs` (`node build-tokens.mjs`).
Las clases van siempre por rol (`bg-surface-2 text-text-muted`), nunca con hex.

## Lo que NO se copia

- **Iconos:** Lucide (ISC) en todo el producto. Ni los iconos de Tripo ni su logo.
- **Tipografía:** Inter (OFL) y JetBrains Mono (OFL), autoalojadas.
- **Ilustraciones y estados vacíos:** dibujos propios o ninguno; nunca el icono de bandeja del original.
- **Textos:** todos nuevos. Ejemplos de este documento: "Genera", "Arrastra una imagen", "Aún no tienes modelos".
- **Color de marca:** el amarillo del CTA y el morado de selección son los roles `accent` y
  `highlight`, con valores neutros provisionales. `/replica-brand` pone los tuyos.
- **Composición distintiva:** la barra superior flotante con píldoras y el panel izquierdo
  con carril de iconos son patrones comunes (Figma, Blender, Meshy); se mantienen, pero con
  proporciones, iconos y textos propios.

Accesibilidad para todos: foco visible (`:focus-visible`, anillo de 2 px `focus` con 2 px de
separación), objetivos táctiles ≥ 32 px (≥ 40 px en móvil), `prefers-reduced-motion`
respetado, ningún estado comunicado solo con color.

---

```
Button
  variants  primary (accent), secondary (surface-3), ghost (transparente), danger, icon
            cost: primary con insignia de créditos a la derecha ("Genera · ⚡ 15")
  sizes     sm 32px, md 40px, lg 48px (CTA de generación, ancho completo del panel)
  states    default, hover (accent-hover / surface-3 → border), active (escala .98),
            focus-visible, disabled (opacidad .4, cursor not-allowed),
            loading (spinner + texto visible "Enviando…", ancho fijo),
            locked (icono candado + tooltip "Disponible en Pro"; sigue siendo pulsable y abre el aviso de plan)
  tokens    primary: bg accent, text on-accent, radius pill, type sm/600
            secondary: bg surface-3, text text, border border
            danger: bg transparente, text danger, border danger
  a11y      <button> real; loading → aria-busy="true" y conserva la etiqueta;
            icon → aria-label obligatorio; locked → aria-describedby al tooltip
  used on   todas; CTA en S01, S03; Export en S05, S07, S08
```

```
TopNav
  variants  con sesión (saldo de créditos + avatar), sin sesión (botón "Entrar")
  layout    altura nav-height (48), separada nav-inset (12) de los bordes, radius pill, bg surface/90 + blur
  partes    logo propio, menú "Crear" (desplegable: Alto detalle, Topología limpia, Imagen),
            enlaces Inicio · Mis modelos · Galería, saldo ("⚡ 185"), avatar con menú
  states    enlace activo (subrayado 2px text), desplegable abierto, scroll (sombra float)
  a11y      <nav aria-label="Principal">; desplegable = menu button con flechas, Esc cierra y devuelve el foco
  móvil     < md: logo + saldo + botón menú que abre una hoja lateral
  used on   todas
```

```
ToolRail
  variants  item normal, item con submenú (chevron), item bloqueado
  layout    ancho tool-rail (64), items 56px alto, icono 20px + etiqueta xs
  states    activo (bg highlight-surface, icono text, barra izquierda 2px highlight), inactivo (text-muted),
            hover (text), bloqueado (candado pequeño), focus-visible
  a11y      role="tablist" vertical, cada item role="tab" con aria-controls al panel; flechas arriba/abajo
  móvil     < lg: pasa a barra inferior con scroll horizontal
  used on   S03, S05
```

```
SegmentedControl
  variants  2 opciones (Alto detalle / Topología limpia), 3 (1/2/4 variantes), iconos (modos de entrada)
  sizes     sm 32px, md 36px
  states    seleccionado (bg surface-3 o accent en el de serie, text), no seleccionado (text-muted),
            hover, focus-visible, opción deshabilitada, opción bloqueada (candado)
  tokens    contenedor bg surface, radius pill, padding 4
  a11y      role="radiogroup" con role="radio"; flechas izquierda/derecha mueven y seleccionan
  used on   S01, S03
```

```
Dropzone
  variants  single (una imagen), multiview (4 huecos: frente, izquierda, detrás, derecha; mínimo 2),
            batch (rejilla de miniaturas, hasta max_batch_size), model (OBJ/FBX/STL/GLB)
  states    vacía (icono upload + "Arrastra una imagen o haz clic" + límites "JPG, PNG o WEBP · hasta 20 MB"),
            arrastrando encima (borde discontinuo highlight, bg highlight-surface),
            subiendo (barra de progreso + cancelar), cargada (miniatura + botón quitar + reemplazar),
            error (borde danger + mensaje: tamaño, formato, imagen demasiado pequeña < 512 px)
  tokens    bg surface, border 1px dashed border-input, radius lg; fondo de tablero en la miniatura (transparencias)
  a11y      el área entera es un <button> que abre el <input type=file>; pegar con Ctrl+V también vale;
            errores en aria-live="polite"
  used on   S01, S03, S06
```

```
PromptField
  variants  principal (prompt), textura (opcional, colapsado por defecto)
  states    vacío (placeholder propio), escribiendo, contador de caracteres (aparece al 80%, danger al 100%),
            error (vacío al generar), deshabilitado
  tokens    bg surface, text text, border border-input, radius md, type sm; 4 filas que crecen hasta 8
  a11y      <textarea> con <label> visible; contador con aria-live; Ctrl+Enter genera
  used on   S03
```

```
SettingsPopover
  variants  "Geometría y textura" (alto detalle), "Topología" (topología limpia)
  contenido toggles (Ultra, PBR, quitar iluminación), chips de resolución 2K/4K/8K, Quad/Triángulos,
            slider de polígonos
  states    abierto, cerrado; los cambios se guardan como preferencia del usuario
  tokens    bg surface-2, border border, radius lg, shadow pop, ancho 320
  a11y      abre con botón aria-expanded; foco atrapado dentro; Esc cierra y devuelve el foco
  móvil     < md: hoja inferior
  used on   S03
```

```
Toggle
  variants  normal, premium (etiqueta "Pro" al lado)
  states    on (bg accent, pomo on-accent), off (bg surface-3, pomo text-muted), hover, focus-visible,
            disabled, locked (off + candado; al pulsar abre el aviso de plan)
  sizes     36×20
  a11y      <button role="switch" aria-checked>; etiqueta clicable; tooltip de ayuda con icono "?" accesible
  used on   S03
```

```
Slider + NumberField
  variants  polígonos (500–25 000 en topología limpia; 500–2 000 000 en alto detalle)
  states    dentro de rango, fuera de rango en el campo (danger + mensaje), arrastrando, deshabilitado
  tokens    pista surface-3, relleno highlight, pomo text 16px; campo como Input sm
  a11y      <input type=range> con aria-valuetext ("10 000 polígonos"); el campo numérico va sincronizado
  used on   S03
```

```
ChipGroup
  variants  opciones (2K/4K/8K, Quad/Triángulos), filtros (Todo, Topología limpia, Con textura, Con rig),
            categorías de galería
  states    activo (bg highlight-surface, border highlight, text), inactivo (border border, text-muted),
            hover, focus-visible, bloqueado (candado), deshabilitado
  tokens    radius pill, alto 32, padding x 12, type xs/500
  a11y      opciones exclusivas → radiogroup; filtros → botones con aria-pressed
  used on   S03, S06, S09, S08
```

```
PrivacySelect
  variants  Público (icono globo), Privado (icono candado)
  states    público, privado, bloqueado en gratis (privado deshabilitado + "Privado en planes de pago")
  a11y      listbox o radiogroup de 2; explica la consecuencia: "Cualquiera podrá ver y descargar este modelo"
  used on   S03, S05
```

```
Select
  variants  versión del modelo, formato de exportación
  states    cerrado, abierto, opción seleccionada, opción bloqueada, focus-visible, disabled
  tokens    trigger como Input; lista bg surface-2, shadow pop, radius md
  a11y      base accesible (Angular CDK Listbox / Overlay); escribir para buscar; Esc cierra
  used on   S03, S08
```

```
Input
  variants  text, search (icono lupa + botón limpiar), number
  sizes     sm 32, md 40
  states    default, hover, focus (border focus), error (border danger + mensaje), disabled, read-only
  tokens    bg surface, border border-input, text text, placeholder text-muted, radius md
  a11y      <label> siempre (visible o sr-only en la búsqueda); error enlazado con aria-describedby
  used on   S06, S09, S12, S02
```

```
Viewer3D
  variants  editable (workspace), solo lectura (ficha pública), miniatura animada (tarjeta en hover)
  partes    canvas three.js con OrbitControls; fondo degradado radial viewport-from → viewport-to;
            gizmo de ejes arriba a la derecha; barra vertical: iluminación, captura PNG, malla/rejilla/textura,
            ayuda de controles; estadísticas (caras, vértices) en xs
  states    vacío (título + subtítulo propios, sin ilustración del original),
            cargando (esqueleto + porcentaje de descarga del GLB), listo,
            generando (anillo de progreso centrado con % y fase "En cola · 3 por delante" / "Generando"),
            error (mensaje + "Reintentar"), WebGL no disponible (imagen estática + aviso)
  a11y      el canvas lleva role="img" y aria-label con el nombre del modelo; controles alternativos con
            teclado (flechas giran, +/- zoom, 0 reinicia); los botones de la barra son <button> con aria-label
  used on   S03, S05, S07
```

```
TaskCard
  variants  en cola, generando (progreso %), lista (miniatura), fallida, cancelada
  partes    miniatura o placeholder, tipo + serie ("Imagen · Alto detalle"), tiempo, coste, acciones
            (cancelar si en cola, reintentar si fallida, abrir si lista)
  states    hover, seleccionada, focus-visible
  tokens    bg surface, radius lg, barra de progreso highlight sobre surface-3
  a11y      progreso con role="progressbar" aria-valuenow; cambios de estado anunciados en aria-live="polite"
  used on   S04, S06
```

```
ModelCard
  variants  mis modelos (con menú: renombrar, privacidad, exportar, borrar), galería (autor + guardar)
  states    default, hover (vista previa girando o segunda imagen; acciones visibles), seleccionada,
            focus-visible (las acciones también aparecen con foco), caducando ("Se borra en 6 h")
  tokens    bg surface, radius lg, ratio 1:1 en assets / altura libre en galería (masonry)
  a11y      la tarjeta es un enlace; el menú es un botón aparte (no anidado en el enlace)
  used on   S06, S07 (relacionados), S09
```

```
Modal / Dialog
  variants  acceso (S02), exportar (S08), sin créditos / función de pago (S13), subir modelo, confirmar borrado
  sizes     sm 400, md 520
  states    abriendo/cerrando (fade + escala .98, motion base), enviando (botón loading), error en línea
  tokens    overlay overlay/60, panel bg surface-2, radius xl, shadow pop, padding 24
  a11y      <dialog> o CDK Dialog: foco atrapado, Esc cierra, foco vuelve al disparador,
            aria-labelledby al título; la confirmación de borrado pone el foco en "Cancelar"
  used on   S02, S08, S13, S06
```

```
PaywallNotice (contenido de S13)
  variants  sin créditos ("Te faltan 85 créditos"), función de pago ("Las texturas 4K son de Pro"),
            límite de exportaciones, límite de tareas a la vez
  partes    qué falta, cuánto cuesta, saldo actual, CTA a planes, CTA secundario a packs
  a11y      dentro de Modal; el mensaje dice el número exacto, no solo "mejora tu plan"
  used on   S03, S05, S08
```

```
PlanCard
  variants  normal, destacada (border highlight + etiqueta "Más elegida"), actual (botón deshabilitado "Tu plan")
  partes    nombre, precio mensual equivalente, total anual, créditos ≈ modelos, lista de ventajas, CTA
  tokens    bg surface, radius xl, padding 24
  a11y      lista de ventajas como <ul>; el precio se lee completo ("13 euros al mes, 156 al año")
  used on   S10
```

```
BillingToggle
  variants  mensual / anual con etiqueta de descuento
  a11y      radiogroup de 2
  used on   S10
```

```
ComparisonTable
  states    fila con ✓ / — / texto; columna del plan actual resaltada
  a11y      <table> real con <th scope>; ✓ y — con texto sr-only ("incluido", "no incluido")
  móvil     < md: un acordeón por plan
  used on   S10
```

```
Tag / Badge
  variants  etiqueta de modelo, "Nuevo", "Beta", plan (Pro/Max), versión ("Alto detalle · 4K")
  tokens    radius pill, alto 20–24, type xs/500, bg surface-3, text text-muted
  used on   S03, S07, S06
```

```
Avatar + FollowButton (could)
  states    siguiendo / no siguiendo; sin foto → iniciales sobre surface-3
  a11y      botón con aria-pressed
  used on   S07
```

```
Toast
  variants  success, error, info
  states    entra, visible 5 s (pausa con hover/foco), sale; con acción opcional ("Ver modelo")
  tokens    bg surface-2, border izquierda 3px del color de estado, radius md, shadow float
  a11y      región aria-live (polite; assertive para error); nunca la única forma de ver un error
  used on   todas
```

```
EmptyState
  variants  workspace vacío, sin modelos, galería sin resultados, sin conexión
  partes    icono Lucide 32px text-muted, título lg, texto sm text-muted, CTA primario
  textos    "Aún no tienes modelos" / "Sube una imagen y genera el primero"
  used on   S03, S06, S09
```

```
Skeleton / ProgressBar / Spinner
  tokens    surface-3 con brillo animado (respeta reduced-motion); progreso highlight; spinner 16/20px
  a11y      skeleton aria-hidden + aria-busy en el contenedor; progressbar con valor
  used on   S04, S05, S06, S09
```

```
Tooltip
  states    aparece con hover (300 ms) y con foco; Esc cierra
  tokens    bg surface-3, text text, type xs, radius sm
  a11y      role="tooltip" + aria-describedby; nunca contenido interactivo dentro
  used on   S03 (ayudas "?"), barra del visor
```
