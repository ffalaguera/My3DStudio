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

## Decisión pendiente: el motor 3D

Sigue abierta (ver `architecture.md`). El servidor tiene la interfaz `GenerationProvider` (`src/provider/provider.ts`)
y solo el adaptador `fake`, que genera una vasija procedural por revolución. **Imagen a 3D y texto a 3D no son reales
hasta que se elija y se conecte un motor.** La API de Tripo queda descartada por sus términos.

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
