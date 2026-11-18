# Arquitectura: (nombre por decidir), una versión propia de las funciones principales de Tripo Studio

Lee: `replica/recon.md`, `replica/features.csv`. Fecha: 2026-11-18.
Esquema completo en `replica/schema.sql`, cargado y probado en Postgres (ver "Verificación").

## Decisión abierta: el motor de generación 3D

Es lo que más pesa: decide la calidad, el margen por modelo y si se puede vender en la UE.

**La API de Tripo queda descartada para este clon.** Sus términos de Studio prohíben usar sus
salidas para "any product or service, that competes" con ellos, y los de la API piden
autorización previa por escrito para ofrecerla a usuarios finales. Un clon de Tripo es
exactamente un competidor, así que la autorización no es realista.

Las alternativas ya están comparadas en `clon-meshy/replica/architecture.md` (precios y
términos comprobados el 2026-11-18): Hunyuan3D v3 o Rodin vía fal.ai (términos de fal
ambiguos para reventa; la licencia de Hunyuan3D 2.1 excluye la UE), o TRELLIS.2 en GPU
serverless (código MIT; licencia de los pesos sin verificar).

**Recomendación:** TRELLIS.2 en Modal o RunPod como primera opción, porque es el único
camino sin un tercero que pueda cerrarte el grifo por competir. Antes de pagar GPU hay que
leer la licencia de los pesos. La app no depende de esta decisión: todo pasa por una
interfaz `GenerationProvider` con un adaptador por proveedor y un **proveedor falso** que
devuelve un GLB de ejemplo tras unos segundos de "progreso". Así se construye la app
entera antes de decidir.

Cómo encaja la serie HD frente a Smart Mesh sin un modelo propio tipo P2.0:

- **HD** = salida directa del motor (malla densa con textura).
- **Smart Mesh** = salida del motor + remallado en el trabajador (decimación con Blender
  hasta el `face_limit`, quads con el remesher de Blender o Instant Meshes, que es BSD).
  No igualará la topología de P2.0 el primer día; es la parte con más riesgo de calidad.

Nada de esto es asesoramiento legal.

## Stack

El mismo que en clon-meshy, que a su vez sale de RentaHogar. Si al final construyes solo uno
de los dos clones, el código se puede compartir entero.

| capa | elección | por qué |
| --- | --- | --- |
| web | Angular + TypeScript | es tu stack (RentaHogar) |
| estilos | Tailwind con los tokens de `/replica-design` | tokens en un sitio, aspecto propio (no el de Tripo) |
| visor 3D | three.js (GLTFLoader, OrbitControls) | estándar, carga GLB con PBR, wireframe y rejilla de serie |
| API | Express + TypeScript | es tu stack; SSE sencillo para el progreso |
| base de datos | Postgres en Supabase (región UE) | una sola base, copias incluidas, datos en la UE (RGPD) |
| acceso a datos | `pg` + migraciones SQL con `node-pg-migrate` | lo que ya usas, sin ORM nuevo |
| autenticación | Supabase Auth: Google + email (enlace mágico) | gestionado; Express solo verifica el JWT. Apple/Microsoft/Discord se añaden después |
| reglas de acceso | comprobación en la capa de datos de Express (`where user_id = $1`; las rutas públicas filtran `privacy = 'public'`), con RLS activado y sin políticas | Express es el único cliente de la base |
| cola de tareas | pg-boss (cola dentro de Postgres) | sin infraestructura extra; reintentos, prioridad por plan y cron |
| trabajador | proceso Node aparte en Docker con Blender sin interfaz | remallado, conversión GLB → FBX/OBJ/USDZ/STL/3MF, miniaturas, estadísticas |
| GPU | Modal o RunPod serverless (si TRELLIS.2) | se paga por segundo y escala a cero |
| archivos | Cloudflare R2 con URLs firmadas | modelos de hasta 150 MB y sin coste de salida |
| pagos | Stripe Checkout + Billing + Customer Portal | suscripción mensual/anual y packs sin formularios de tarjeta propios |
| email | Resend | verificación, recibos, aviso de créditos bajos |
| hosting | Angular estático en Vercel o Netlify; API y trabajador en Render (Docker, Frankfurt) | Render tiene workers en segundo plano y región UE |

Una base de datos, una API, un trabajador. Sin microservicios.

## Esquema

Tablas: 18. Reglas de acceso: comprobaciones en la capa de datos de Express, con RLS
activado sin políticas como red de seguridad.

| tabla | qué guarda | prioridad |
| --- | --- | --- |
| `plans` | precio, créditos al mes y **todos los límites del plan** (concurrencia, lote, variantes, exportaciones, historial, reintentos, 8K, privado, comercial, Smart Mesh) | must |
| `credit_packs` | packs de créditos con bonus | should |
| `profiles` | usuario (id = `auth.users.id`), username para fichas públicas, plan actual | must |
| `subscriptions` | suscripción de Stripe | must |
| `credit_accounts` | saldo mensual, saldo permanente y **congelado por bolsa** | must |
| `credit_ledger` | cada movimiento: grant, purchase, freeze, consume, release, expire, adjust | must |
| `uploads` | imágenes y modelos subidos (límite de tamaño en la base) | must |
| `tasks` | cada trabajo: tipo, serie HD/Smart, estado, progreso, prompt, parámetros, coste, error, lote, reintento | must |
| `task_inputs` | 1 imagen o 2–4 vistas (front/left/back/right) por tarea | must |
| `assets` | cada modelo; `variant_index` para las 1/2/4 variantes; privacidad, licencia, caducidad | must |
| `asset_files` | un archivo por formato y opciones en R2 | must |
| `texture_maps` | mapas PBR por asset | should |
| `exports` | cada exportación (límite mensual del gratuito) | must |
| `tags`, `asset_tags` | categorías y etiquetas de la galería | could |
| `collections` | "Collected" en Mis assets | could |
| `reports` | denuncias de modelos públicos | could (must si la galería sale) |
| `stripe_events` | eventos de Stripe ya procesados (idempotencia) | must |

### Restricciones duras que salen del recon

- **Congelar y consumir créditos** (como Tripo): crear la tarea mueve créditos de
  `monthly_balance`/`permanent_balance` a `frozen_*` en una transacción con
  `select ... for update` sobre `credit_accounts`. Se gasta primero la bolsa mensual.
  `success` → `consume`; `failed`/`cancelled` → `release` a la bolsa de origen.
  Índices únicos parciales: una sola congelación, un solo consumo y una sola liberación
  por tarea y bolsa. **Ningún saldo puede ser negativo** (`check`).
- **Doble clic en Generar:** índice único `tasks (user_id, idempotency_key)`.
- **Concurrencia por plan** (1 / 10 / 100): se cuentan las tareas `queued + running` del
  usuario dentro de la misma transacción que congela, con la fila de créditos bloqueada.
  Las que pasan del límite quedan en `queued` y pg-boss solo las arranca cuando hay hueco.
- **Una variante, un asset:** índice único `assets (task_id, variant_index)`.
- **Una generación necesita serie** y **texto a 3D necesita prompt**: `check` en `tasks`.
- **Tamaños:** imagen ≤ 20 MB, modelo ≤ 150 MB, en `uploads`.
- **Privado solo en planes de pago** y **Smart Mesh limitado en gratis**: se comprueban en
  `POST /tasks` y `PATCH /assets/:id` leyendo `plans`. No van en la base porque dependen
  del plan actual, que cambia.

## API

Todas las rutas van bajo `/api` con el JWT de Supabase, salvo donde se indica. El proveedor
de IA solo lo llama el trabajador, nunca el navegador. Nunca se usan endpoints de Tripo.

### F01, F02, F03, F07: generar

| método y ruta | hace | quién | entrada | salida | flujo |
| --- | --- | --- | --- | --- | --- |
| `POST /uploads` | crea la fila y da una URL firmada de R2 para subir directo | usuario | `{kind, content_type, size_bytes}` | `{upload_id, put_url}`; 413 si pasa el límite | F01 F07 |
| `POST /uploads/:id/complete` | confirma la subida, lee dimensiones, marca `ready` | dueño | – | `{upload}`; 422 si no es imagen válida | F01 |
| `POST /tasks/estimate` | créditos, tiempo estimado y si el plan lo permite | usuario | `{type, series, params}` | `{credits, eta_seconds, allowed, reason?}` | F01–F03 |
| `POST /tasks` | valida plan, congela créditos, crea tarea y la encola | usuario | `{type, series, prompt?, texture_prompt?, params, inputs: [{upload_id, view}], input_asset_id?, privacy}` + `Idempotency-Key` | `{task}`; 402 sin créditos; 403 función de pago | F01–F03 |
| `POST /tasks/batch` | N tareas de imagen a 3D con el mismo `batch_id` | usuario (pago) | `{series, params, upload_ids[]}` + `Idempotency-Key` | `{batch_id, tasks}`; 403 si N > `max_batch_size` | F07 |
| `GET /tasks/:id` | estado, progreso y assets resultantes | dueño | – | `{task, assets}` | F01 |
| `GET /tasks/:id/events` | progreso en vivo (SSE) | dueño | – | eventos `progress`, `status` | F01 |
| `GET /tasks?status=active` | cola del usuario | usuario | – | `{tasks}` | F01 F07 |
| `DELETE /tasks/:id` | cancela si está `queued` y libera créditos | dueño | – | `{task}`; 409 si ya está `running` | F01 |
| `POST /tasks/:id/retry` | nueva tarea con los mismos datos; gratis si quedan reintentos del plan | dueño | `Idempotency-Key` | `{task}` | F01 |

`type` y `params` por serie:

| type | series | params principales | coste (placeholder, se fija en /replica-launch) |
| --- | --- | --- | --- |
| `image_to_model` | hd | `texture_resolution 2k/4k/8k`, `pbr`, `ultra`, `topology tri/quad` | 15 |
| `image_to_model` | smart | `face_limit 500–25000`, `topology quad/tri`, `variants 1/2/4` | 100 × variantes |
| `text_to_model` | hd / smart | igual que arriba + `prompt`, `texture_prompt` | igual |
| `multiview_to_model` | hd / smart | 2–4 `inputs` con `view` | igual |
| `retexture`, `retopo`, `smart_uv`, `segment`, `rig`, `animate` | – | `input_asset_id` + propios | could |

### F05: Mis assets

| método y ruta | hace | quién | entrada | salida | flujo |
| --- | --- | --- | --- | --- | --- |
| `GET /assets` | lista con búsqueda, filtros y cursor; oculta caducados | usuario | `q, kind, series, has_texture, is_rigged, collected, cursor` | `{assets, next_cursor}` | F05 |
| `GET /assets/:id` | detalle con archivos, mapas y variantes hermanas | dueño | – | `{asset}` | F05 |
| `PATCH /assets/:id` | renombrar, cambiar privacidad | dueño | `{name?, privacy?}` | `{asset}`; 403 privado en gratis | F05 |
| `DELETE /assets/:id` | borra el asset y sus archivos de R2 | dueño | – | 204 | F05 |
| `POST /assets/:id/export` | URL firmada; si falta el formato, encola `convert` | dueño (o cualquiera si es público) | `{format, include_textures}` | `{url}` o `{task}`; 403 si llegó al límite | F01 F05 |

### F04: cuenta, créditos y pagos

| método y ruta | hace | quién | entrada | salida | flujo |
| --- | --- | --- | --- | --- | --- |
| `GET /me` | perfil, plan, saldos (disponible y congelado), uso del mes | usuario | – | `{profile, plan, credits, usage}` | F04 |
| `PATCH /me` | username, nombre, avatar | usuario | `{username?, display_name?}` | `{profile}`; 409 username ocupado | – |
| `GET /credits/ledger` | historial de créditos | usuario | `cursor` | `{entries}` | F04 |
| `GET /plans` | planes públicos | cualquiera | – | `{plans}` | F04 |
| `GET /credit-packs` | packs activos | cualquiera | – | `{packs}` | F04 |
| `POST /billing/checkout` | sesión de Stripe Checkout para un plan | usuario | `{plan_id, interval}` | `{url}` | F04 |
| `POST /billing/credit-pack` | Checkout de un pack | usuario | `{pack_id}` | `{url}` | F04 |
| `POST /billing/portal` | Customer Portal (cambiar o cancelar) | usuario | – | `{url}` | F04 |
| `DELETE /me` | borra cuenta y datos (RGPD) | usuario | confirmación | 202 | – |

### F06: galería pública (could)

| método y ruta | hace | quién | entrada | salida | flujo |
| --- | --- | --- | --- | --- | --- |
| `GET /public/models` | galería con categoría y búsqueda | cualquiera | `tag, q, cursor` | `{models, next_cursor}` | F06 |
| `GET /public/models/:id` | ficha pública (S07) | cualquiera | – | `{model, author, related}`; 404 si es privado | F06 |
| `POST /public/models/:id/recraft` | copia la imagen de entrada a una subida del usuario y devuelve el prompt | usuario | – | `{prompt, upload_id?}` | F06 |
| `PUT /assets/:id/collect` / `DELETE` | guardar o quitar de "Collected" | usuario | – | 204 | F05 F06 |
| `POST /public/models/:id/report` | denunciar | usuario | `{reason, details}` | 201 | – |

Rutas: 30 (10 de generación, 5 de assets, 9 de cuenta, 6 públicas), más 2 webhooks = **32**.

### Webhooks

- **Entrada, Stripe** `POST /webhooks/stripe` (sin JWT; verifica la firma):
  `checkout.session.completed` (pack: suma permanente), `invoice.paid` (caduca la bolsa
  mensual y concede la nueva), `customer.subscription.updated`,
  `customer.subscription.deleted` (vuelve a gratis), `invoice.payment_failed` (email).
- **Entrada, proveedor de IA** `POST /webhooks/provider/:name` si lo ofrece (verifica la
  firma); si no, el trabajador consulta cada 2–5 s.
- **Salida:** ninguno en esta versión.

### Trabajos en segundo plano (pg-boss)

| trabajo | cuándo | hace |
| --- | --- | --- |
| `generate` | al crear la tarea, respetando concurrencia del plan y la global del proveedor | llama al proveedor, guarda el progreso y emite `NOTIFY`; al terminar encola `postprocess`; si falla, `release` |
| `postprocess` | tras `generate` | copia el resultado a R2, remalla si es Smart Mesh, crea un asset por variante, miniatura, estadísticas, GLB; `consume` créditos y pone `success` |
| `convert` | al exportar un formato que falta | Blender convierte y guarda en `asset_files` |
| `grant-free-credits` | día 1 de cada mes, 00:00 UTC | caduca la bolsa mensual de los gratuitos y concede 200 |
| `expire-history` | cada hora | borra assets con `expires_at` vencido (historial de 1 o 7 días) y sus archivos |
| `reap-stuck` | cada 5 min | marca `failed` las tareas `running` de más de 30 min y libera créditos |
| `cleanup-uploads` | cada día | borra subidas `pending` de más de 24 h |
| `purge-account` | al borrar una cuenta | borra filas y la carpeta del usuario en R2 |

## Lo que muerde

- **Zonas horarias:** los gratuitos renuevan el día 1 a las 00:00 UTC; los de pago en su
  fecha de factura. Todo `timestamptz`; la interfaz muestra la hora local.
- **Idempotencia:** Stripe reenvía eventos (`stripe_events` + índice único por evento en
  el ledger). `Idempotency-Key` en `POST /tasks`. Congelar, consumir y liberar tienen
  índice único por tarea: un trabajo que se reintenta no puede cobrar ni devolver dos veces.
- **Créditos congelados que cruzan el fin de ciclo:** si una tarea congela créditos
  mensuales y falla después de la renovación, se liberan como `release` y en la misma
  transacción un `expire`: no se regalan créditos caducados.
- **Condiciones de carrera:** dos pestañas generando a la vez; por eso todo movimiento de
  créditos bloquea la fila de `credit_accounts`.
- **Cola global del proveedor:** la GPU (o fal) tiene su propio tope. pg-boss limita la
  concurrencia global por proveedor; si no, el usuario ve errores en vez de "en cola".
  Prioridad: pago antes que gratis (Tripo vende "queue priority").
- **Coste por modelo frente a precio:** con 200 créditos gratis ≈ 13 modelos, cada usuario
  gratuito cuesta GPU real. Medir el coste por generación con el proveedor elegido antes
  de fijar créditos y precios en `/replica-launch`.
- **Variantes:** 4 variantes son 4 generaciones de GPU. El coste en créditos se multiplica
  y la tarea solo es `success` cuando todas terminan; si falla una, se libera su parte
  (asset parcial) o todo: decidir. Propuesta: todo o nada, más simple.
- **Tamaños de archivo:** subida directa a R2 con URL firmada; Express nunca hace de proxy.
- **Archivos maliciosos:** Blender abre modelos subidos por usuarios. El trabajador corre
  en un contenedor sin red de salida (salvo R2), con límites de memoria y tiempo.
- **Moderación:** prompts e imágenes pasan un filtro antes de congelar créditos; los
  modelos públicos tienen botón de denuncia. Sin galería pública esto baja de prioridad.
- **Contenido público por defecto:** en gratis todo es público (como Tripo). Si sale la
  galería, eso es contenido de usuarios publicado por ti: términos, denuncias y retirada.
- **Licencia de las salidas:** prometer "atribución en gratis, comercial en pago" depende
  de la licencia del motor elegido. Se decide junto con el motor.
- **Búsqueda:** índice trigram sobre `assets.name`. Suficiente.
- **Tiempo real:** SSE alimentado por `LISTEN/NOTIFY`; si se corta, el cliente consulta
  `GET /tasks/:id`. El usuario puede cerrar la pestaña: la tarea sigue y aparece en S06.
- **Retención del proveedor:** sus URLs caducan (en Tripo, 5 minutos). `postprocess`
  copia todo a R2 de inmediato.
- **RGPD:** base en UE, borrado de cuenta real, política de privacidad con cada
  encargado: Supabase, R2, Render, Stripe, Resend, Modal/RunPod o fal (reciben las
  imágenes de los usuarios).
- **Email:** solo transaccional; SPF, DKIM y DMARC en el dominio.

## Orden de construcción

1. **Corte vertical**: registrarse, subir una imagen, ver el progreso, ver el modelo en el
   visor, descargar el GLB. Feo pero funcionando, con el **proveedor falso**.
   - Pantallas: S02, S03 (solo imagen + HD), S04, S05, S08 (solo GLB).
   - Tablas: `plans`, `profiles`, `credit_accounts`, `credit_ledger`, `uploads`, `tasks`,
     `task_inputs`, `assets`, `asset_files`, `exports`.
   - Rutas: `POST /uploads`, `POST /uploads/:id/complete`, `POST /tasks/estimate`,
     `POST /tasks`, `GET /tasks/:id`, `GET /tasks/:id/events`,
     `POST /assets/:id/export`, `GET /me`.
   - Trabajos: `generate`, `postprocess`.
2. **Must-haves**:
   - Texto a 3D (F02) y selector HD / Smart Mesh con remallado en el trabajador (F03).
   - FBX, OBJ y STL: trabajo `convert` con Blender.
   - Mis assets (S06): `GET/PATCH/DELETE /assets`, privacidad, `expire-history`.
   - Cancelar, `reap-stuck`, liberar créditos.
   - Planes, Stripe y límites (S10, S11, S12, S13): `subscriptions`, `stripe_events`,
     rutas `/billing/*`, webhook de Stripe, `grant-free-credits`.
   - Inicio S01 con caja de generación rápida.
   - Adaptador del proveedor real elegido y medición de coste por modelo.
   - Borrado de cuenta.
3. **Should-haves**: multivista, 4K y PBR (`texture_maps`), quad/tri y polycount,
   prompt de textura, variantes 1/2/4, packs de créditos, reintentos, filtros de assets,
   USDZ y 3MF, opciones de exportación, historial de créditos.
4. **Could-haves**: lotes, retopología, UV, retexturizado, rig y animación, segmentación,
   galería pública con ficha y Recraft (`tags`, `collections`, `reports`), generar imagen
   de referencia, subir modelo propio.
5. **Mejoras de `/replica-entrepreneur`**: cuando se ejecute.

## Verificación

`schema.sql` cargado en Postgres embebido (pgserver) con un esquema `auth.users` de prueba:
18 tablas creadas sin errores. Rechazados como se espera: saldo negativo, doble
congelación de la misma tarea, `idempotency_key` repetida, generación sin serie, texto a
3D sin prompt, imagen de 30 MB, tarea terminada sin `finished_at`. Borrar el usuario de
`auth.users` borra sus tareas en cascada. No se ha probado en Supabase real (extensiones
y `auth` reales).
