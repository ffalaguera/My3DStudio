# Plan de lanzamiento de My3DStudio

## Antes de abrir

- [ ] **Nombre:** valorar con un abogado de marcas el riesgo de «My3DStudio» frente a «3D AI Studio» ([brand.md](../brand.md)).
- [ ] **Dominio:** `my3dstudio.com` está ocupado; elegir `.app` u otro y comprarlo.
- [ ] **Legal:** completar los datos entre corchetes de /privacidad y /terminos y que los revise un abogado:
  - desistimiento de contenido digital;
  - transferencias a EE. UU. (fal, Stripe, Resend);
  - licencia de los modelos generados.
- [ ] **Cuentas de producción:** Supabase en la UE con Google, Stripe con los productos de [pricing.md](pricing.md),
  Resend con el dominio verificado, Cloudflare R2 y auto-recarga de fal con tope.
- [ ] **Medición sin cookies de seguimiento:** analítica (Plausible o PostHog en la UE) y errores (Sentry). Medir:
  - registro;
  - primera generación;
  - primera descarga;
  - compra.
- [ ] **Imagen social (OG)** y una captura real del visor.

## Lista de espera / beta

- Formulario de email en la portada mientras no haya pagos activos («Avísame cuando abra»), guardado en la base con
  consentimiento explícito.
- **Beta cerrada con 20-50 personas:** plan Creador gratis 1 mes a cambio de 15 minutos de conversación. Sus opiniones,
  con permiso, serán la primera prueba social real.

## Dónde están los usuarios descontentos del original

Sitios donde la investigación encontró quejas (ver [feedback.md](../feedback.md)). **No se hace spam ni se nombra al
competidor en anuncios:** se participa como persona y se enlaza solo cuando alguien pregunta por alternativas.

- **Comunidades de impresión 3D:** r/3Dprinting, r/resinprinting, r/PrintedMinis, foros de Printables y Thingiverse.
  Es el grupo con más menciones de uso (17 reseñas).
- **Desarrollo de juegos indie:** r/gamedev, r/godot, r/blender. Hilos tipo «AI 3D model generator alternative».
- **Hacker News:** Show HN cuando el motor propio en GPU baje el coste (ver más abajo).

Reddit no se pudo leer durante la investigación: hay que revisar esos hilos a mano antes de participar.

## Product Hunt / Show HN

- **Titular:** «My3DStudio: de una foto a un modelo 3D, con el precio a la vista y la descarga incluida».
- **Primer párrafo:** las tres promesas, cada una con su prueba en el producto:
  - el coste visible en el botón Generar;
  - una descarga en el plan Gratis;
  - el botón de cancelar en Tu cuenta.
- **Sin comparativas** con nombre del competidor (consultar antes con un abogado).
- Mejor día: martes a jueves. Responder a todos los comentarios el mismo día.

## Los primeros 10 usuarios

1. 3-4 makers de impresión 3D (miniaturas, piezas de recambio): ¿el STL/3MF sale imprimible?
2. 2-3 devs indie de juegos: ¿el GLB entra en Godot o Unity sin arreglos?
3. 2 personas que pagaron otra herramienta y la cancelaron: ¿qué les haría quedarse?
4. 1 tienda online que quiera AR (USDZ en iPhone).

A cada uno: una llamada de 15 minutos, mirar cómo genera su primer modelo sin ayudar, y apuntar dónde duda. Sus
problemas van a `features.csv`.

## Después del lanzamiento

- Revisar cada semana:
  - el coste en fal frente a los ingresos;
  - el uso real de créditos por plan;
  - la tasa de fallos del motor.
- **F4 (reembolso automático en 48 h)** y **F6 (reintento gratis si sale mal)** son las siguientes mejoras de
  [fixes.md](../fixes.md).
- **Motor en GPU propia (Modal):** baja el coste por modelo de ~0,28 € a ~0,05 €. Permite bajar créditos por modelo y
  competir también en precio.
