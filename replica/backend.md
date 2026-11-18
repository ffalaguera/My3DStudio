# Backend: clon de Tripo Studio

Código en `clon-tripo/server` (Express 5 + TypeScript, Postgres, pg-boss). Fecha: 2026-11-18.
El frontend elige la API en `web/public/config.json` (`api: fake | http`); ninguna pantalla cambia.

## Arrancar en local (sin cuentas externas)

```bash
npm --prefix clon-tripo/server run db:local
```

```bash
npm --prefix clon-tripo/server run seed
```

```bash
npm --prefix clon-tripo/server run dev
```

```bash
npm --prefix clon-tripo/web start -- --port 4300
```

`.env.local` (ya creado, con secretos aleatorios, fuera de git) usa Postgres 17 embebido, archivos en disco con URLs
firmadas, acceso local sin contraseña (`LOCAL_AUTH=1`), email por consola y el motor falso. "Continuar con Google" en
local entra como `demo@example.com`, el usuario del seed con 3 modelos.

Tests: `npm --prefix clon-tripo/server test` → **23 tests en verde** sobre un Postgres embebido nuevo en cada ejecución.

## Lo que tienes que crear tú (cuentas y claves)

Claude no crea cuentas ni escribe claves. Cuando las tengas, ponlas en `server/.env.local` (servidor) y en
`web/public/config.json` (solo valores públicos). Todas las variables están en `server/.env.example`.

| servicio | qué crear | variables |
| --- | --- | --- |
| Supabase (región UE, Frankfurt) | proyecto; Auth → proveedores Email (magic link) y Google; URL del sitio y redirecciones: `http://localhost:4300` y tu dominio | `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (servidor); `supabaseUrl`, `supabaseAnonKey` (config.json); quita `LOCAL_AUTH` |
| Google Cloud | cliente OAuth "Aplicación web" con tu marca; ámbitos solo `openid email profile`; redirección `https://TU-PROYECTO.supabase.co/auth/v1/callback` | se pega en Supabase → Auth → Google |
| Stripe (modo test) | productos Pro y Max con precio mensual y anual; Customer Portal activado con "cancelar" | `STRIPE_SECRET_KEY` (sk_test_), `STRIPE_WEBHOOK_SECRET` (`stripe listen --forward-to localhost:8787/api/webhooks/stripe`), `STRIPE_PRICE_*` y después `npm run seed` |
| Cloudflare R2 | bucket privado + token de API de lectura/escritura sobre ese bucket; CORS del bucket: `PUT, GET` desde tu dominio | `STORAGE_DRIVER=r2`, `R2_*` |
| Resend | dominio verificado (SPF, DKIM, DMARC) | `EMAIL_DRIVER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` |

Los ámbitos básicos de Google (`openid email profile`) no necesitan la verificación larga de ámbitos sensibles, pero
la pantalla de consentimiento con tu logo y nombre sí pasa una verificación de marca (días). Empiézala pronto.

## Motor 3D: TRELLIS.2 en fal.ai (elegido el 2026-11-18)

Se valoró ejecutarlo en Modal con GPU propia ($30/mes gratis); se descartó en favor de fal (sin servidores ni
construcción de imágenes de GPU). Ese trabajo está revertido en el historial de git por si hiciera falta.

- **Adaptador `fal`** (`src/provider/fal.ts`), activado con `GENERATION_PROVIDER=fal` y `FAL_KEY`:
  - Imagen a 3D → `fal-ai/trellis-2`. La imagen va como data URI: no hace falta que el almacén sea público.
  - Texto a 3D → `fal-ai/flux/schnell` crea una imagen de referencia (fondo liso, objeto centrado) → TRELLIS.2. El
    filtro de seguridad de FLUX corta descripciones no permitidas **antes** de gastar en el 3D.
  - Alto detalle: 1024³, decimación a 500.000 vértices, textura 2K/4K. **8K se entrega como 4K** (máximo de TRELLIS.2).
  - Topología limpia: `decimation_target` = polígonos ÷ 2, `remesh`. **Solo triángulos**: TRELLIS.2 no hace quads, así
    que la opción "Cuadriláteros" hoy no cambia nada (pendiente: retopología a quads en el trabajador con Blender).
  - Variantes: una petición por variante con semillas distintas, en paralelo.
  - "Sin textura": se quitan las imágenes del GLB. PBR: TRELLIS.2 siempre entrega PBR.
  - Progreso: fal no da porcentaje; se estima por estado (en cola / en curso) y tiempo típico.
  - Cancelación: se pide a fal con `cancel_url`. Descargas solo desde dominios de fal (evita SSRF), con tope de tamaño y
    comprobación de cabecera `glTF`.
- **Probado** con un fal simulado (9 tests: parámetros, variantes, texto→imagen→3D, contenido no permitido, 422, fallo de
  ejecución, archivo no GLB, URL ajena, clave rechazada, cancelación, sin textura y recorrido completo del trabajador).
  **Probado con fal real el 2026-11-18** (ver "Pruebas reales" abajo).
- **Si los costes de fal aprietan**: TRELLIS.2 en GPU serverless propia (≈ $0,05/modelo) con la misma interfaz;
  el diseño probado está en el historial (commit `8194d15`, revertido).

### Pruebas reales con fal (2026-11-18)

| prueba | tiempo total | resultado | coste aproximado |
| --- | --- | --- | --- |
| imagen → 3D (jarrón de prueba) | 79 s | **fiel**: la forma y el color de la imagen; 497.078 caras, 303.001 vértices, GLB de 15,1 MB con texturas WebP | ≈ $0,30 |
| texto → 3D ("una tetera de cerámica blanca con asa de bambú") | 67 s | **no fiel**: salió un cuenco blanco, sin pico ni asa; 491.474 caras | ≈ $0,30 + FLUX |
| primer intento de imagen | — | falló en nuestro post-proceso (BUG-009) después de que fal lo cobrara | ≈ $0,30 |
| texto → 3D con traducción al inglés (mismo prompt) | 53 s | **fiel**: tetera blanca de cerámica con asa de bambú; 482.178 caras, GLB de 17,6 MB | ≈ $0,30 + FLUX + traducción |

Total de las pruebas ≈ $0,90–1,00 (cifra exacta en fal.ai → Billing).

Lo aprendido:
- `decimation_target` se comporta como **caras**, no vértices (500.000 → 497.078 caras). El adaptador ya lo trata así.
- Los GLB llegan con `EXT_texture_webp` obligatorio. El servidor ya los lee (BUG-009). Algunos importadores antiguos no
  leen WebP: si da problemas, convertir a PNG en el post-proceso.
- **Texto a 3D en español era poco fiel** (FLUX entiende peor el español). **Resuelto**: antes de FLUX la descripción se
  traduce al inglés con `google/gemini-2.5-flash-lite` vía OpenRouter en fal (`fal.run/openrouter/router/openai/v1/chat/completions`,
  cobro por tokens: fracciones de céntimo). Si la traducción falla, tarda más de 15 s o viene vacía, se usa el texto
  original. Pendiente opcional: enseñar la imagen de referencia antes de gastar en el 3D, como Tripo.
- Si el saldo de fal se acaba, fal responde 403 y todas las generaciones fallan (con créditos devueltos). Activar
  recarga automática o un aviso de saldo bajo antes de lanzar.

### Costes: con fal y los créditos actuales se pierde dinero

| | por modelo | Pro (3.000 créditos, 13–19 €/mes) a 15 créditos = 200 modelos |
| --- | --- | --- |
| fal TRELLIS.2 1024³ | ≈ $0,30 (+ ≈ $0,003 de FLUX en texto a 3D) | ≈ $60 de coste por usuario Pro que lo gaste todo |
| TRELLIS.2 propio en Modal (H100 ≈ $0,0011/s, ~40 s con post-proceso) | ≈ $0,05 | ≈ $10 |
| Tripo (referencia pública) | $0,16 a usuarios Pro (modelo propio) | — |

Para no perder dinero con fal y los precios provisionales de los planes, un modelo de alto detalle debería costar
**≈ 70–100 créditos** (no 15), o subir los precios. Los costes ya son variables de entorno (`CREDITS_HD`,
`CREDITS_TEXTURE_4K`, `CREDITS_TEXTURE_8K`, `CREDITS_SMART_PER_VARIANT`); la cifra final se decide en `/replica-launch`.
Mientras tanto, `PROVIDER_MAX_CONCURRENCY` limita el gasto simultáneo.
Fuentes de precios: [fal TRELLIS.2](https://fal.ai/models/fal-ai/trellis-2) (la página exacta pide sesión; cifras de
[su guía](https://fal.ai/learn/devs/trellis-2-image-to-3d-prompt-guide)), [Modal](https://www.spheron.network/blog/modal-gpu-pricing-2026-per-second-billing/)
(tercero; confirmar en modal.com/pricing).

### Licencias para revisión legal

No es asesoramiento legal. Comprobado el 2026-11-18; las páginas pueden cambiar.

| componente | licencia | ¿se usa? | fuente |
| --- | --- | --- | --- |
| TRELLIS.2 (código y pesos 4B) | **MIT** | sí, vía fal | [Hugging Face](https://huggingface.co/microsoft/TRELLIS.2-4B), [GitHub](https://github.com/microsoft/TRELLIS.2) |
| nvdiffrast (horneado de texturas al exportar GLB) | NVIDIA Source Code License "1-Way Commercial": **solo no comercial** | dentro del pipeline de fal (no sabemos si lo han sustituido) | [issue #22 de TRELLIS.2](https://github.com/microsoft/TRELLIS.2/issues/22), [texto de la licencia](https://huggingface.co/spaces/ginipick/SORA-3D/blob/e3df509037b8d7a49ea8599caebb1c08922cea96/extensions/nvdiffrast/LICENSE.txt) |
| nvdiffrec | igual que nvdiffrast | solo visualización; no hace falta | issue #22 |
| DINOv3 (codificador de imagen, obligatorio) | Licencia propia de Meta; permite uso comercial | sí, vía fal | [Meta](https://ai.meta.com/resources/models-and-libraries/dinov3-license) |
| RMBG-2.0 (quitar fondo en el pipeline oficial) | CC BY-NC 4.0 / licencia comercial de Bria: **no comercial** sin acuerdo | posiblemente dentro de fal | [Hugging Face](https://huggingface.co/briaai/RMBG-2.0) |
| FLUX.1 [schnell] | Apache 2.0 (confirmar en su ficha) | sí, vía fal (texto a 3D) | [fal](https://fal.ai/models/fal-ai/flux/schnell/api) |
| Hunyuan3D 2.x | Licencia de Tencent: **excluye la UE, el Reino Unido y Corea del Sur** | **no** | [LICENSE](https://huggingface.co/tencent/Hunyuan3D-2.1/blob/main/LICENSE) |
| Tripo API | sus términos prohíben usar las salidas para competir | **no** | tripo3d.ai/terms |

Preguntas para el abogado y para fal (por escrito):
1. ¿El endpoint `fal-ai/trellis-2` usa nvdiffrast y RMBG-2.0, o los ha sustituido? Si los usa, ¿cubre fal la licencia
   comercial o recae en el cliente?
2. ¿Permiten los términos de fal ofrecer la generación a usuarios finales dentro de un producto de pago que compite con
   otros generadores 3D?
3. ¿Qué licencia tienen las salidas que entregamos a los usuarios (para prometer "uso comercial" en los planes de pago)?
4. Para el paso a Modal: las sustituciones previstas son nvdiffrast → [uvrast](https://github.com/memgrafter/uvrast) o
   el horneado con cuBVH de [este fork](https://github.com/maksonlee/TRELLIS.2), y RMBG-2.0 → BiRefNet (verificar su
   licencia). Revisar esos repos de terceros antes de usarlos.

## Hecho

- **Auth**: verificación de JWT de Supabase (JWKS asimétrico o secreto HS256), perfil y 200 créditos en el primer acceso,
  enlace mágico y Google en el frontend, cierre de sesión global, **borrado de cuenta real** (Stripe cancelado, archivos de
  R2, filas en cascada, usuario de Supabase, email de confirmación). Un token de una cuenta borrada da 401.
- **Base de datos**: migraciones SQL versionadas (`server/migrations`, se aplican al arrancar y con `npm run migrate`),
  seed realista sin personas reales, regla de acceso: **comprobación en la capa de datos** (`where user_id = $1` en cada
  consulta) con RLS activado y sin políticas como red de seguridad. Probado con un segundo usuario: 404 en todo.
- **Créditos**: congelar al crear, consumir al terminar, liberar si falla, se cancela o se atasca; devoluciones de un ciclo
  ya renovado caducan. Bloqueo de fila: 20 peticiones simultáneas con saldo para 13 crean exactamente 13.
- **Tareas**: cola en Postgres con repartidor que respeta el límite del plan (1/10/100) y el tope del proveedor, prioridad
  a los de pago; pg-boss para la generación y los cron (UTC) con reintentos y cola `dead-letter`.
- **Tiempo real**: SSE por usuario (`GET /api/events`) con `LISTEN/NOTIFY`; el cliente reconecta y vuelve a consultar.
- **Archivos**: subida directa con URL firmada (local con HMAC, R2 con presign), validación por cabecera real (tipo,
  tamaño, dimensiones mínimas), descarga firmada con caducidad, OBJ y STL convertidos en el servidor; FBX, USDZ y 3MF con
  Blender si `BLENDER_PATH` está configurado.
- **Pagos**: Checkout para suscribirse, Customer Portal para cambiar o cancelar, webhook con firma verificada e
  idempotente (`stripe_events` + índice por evento): `customer.subscription.created/updated/deleted`, `invoice.paid`
  (créditos del periodo), `invoice.payment_failed` (email). El estado vive en la base y lo cambian solo los webhooks.
- **Email**: plantillas propias (pago fallido, cuenta borrada) por Resend o consola.

## Diferencias con architecture.md

- SSE por usuario (`/api/events`) en vez de por tarea: una sola conexión para toda la cola.
- Migraciones con un ejecutor propio de 50 líneas en vez de `node-pg-migrate`.
- `free_retries` de Pro: 20 al mes (no ilimitados), porque cada reintento cuesta GPU.
- `GET /api/capabilities`: el frontend sabe qué formatos y pagos están activos.

## Lista de seguridad

- [x] secretos solo en variables de entorno; `.env*` en `.gitignore`; el frontend solo recibe valores públicos (`config.json`)
- [x] entrada validada con zod en todas las rutas (cuerpo, parámetros, query y cabecera `Idempotency-Key`)
- [x] autorización en cada lectura y escritura, probada con un segundo usuario
- [x] límites de peticiones: subidas, creación de tareas, assets, pagos y login local; el envío de enlaces lo limita Supabase
- [x] webhooks con firma verificada (cuerpo crudo) e idempotentes
- [x] subidas: tipo y tamaño en la URL firmada y comprobados otra vez al completar; en producción, bucket R2 separado
- [x] sin datos del usuario en URLs ni logs: las URLs llevan ids opacos y nombres genéricos; los logs no guardan emails
- [x] `npm audit` de producción: 0 vulnerabilidades en servidor y frontend (zod pasado a la v4 por un aviso alto)
- [ ] política de privacidad con todos los encargados: Supabase, Cloudflare R2, Render, Stripe, Resend, Google (OAuth) y
  el proveedor del motor 3D, que recibe las imágenes. Se redacta en `/replica-launch`
- [ ] **sesión en cookie http-only**: no está. Supabase guarda la sesión en el almacenamiento del navegador y el frontend
  manda el token como Bearer. Mitigación prevista para `/replica-deploy`: CSP estricta y sin scripts de terceros. Pasar a
  cookies con `@supabase/ssr` exige un proxy en el mismo dominio
- [ ] copias de seguridad: en Supabase las diarias van con el plan Pro (el gratuito no las tiene). Revísalo al crear el proyecto

## Pendiente

- Motor 3D real (decisión de producto y licencia).
- Miniaturas: hoy son la imagen de entrada; los modelos creados desde texto no tienen. Hace falta render con Blender en
  el trabajador.
- Acceso con contraseña y restablecimiento (Tripo lo tiene como alternativa; aquí solo enlace mágico y Google).
- Packs de créditos (Checkout en modo `payment` + `checkout.session.completed`).
- Moderación de prompts e imágenes antes de congelar créditos.
- Probar Checkout y Portal con tus claves de test (el webhook ya está probado con eventos firmados).
