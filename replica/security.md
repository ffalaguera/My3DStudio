# Revisión de seguridad de My3DStudio (2026-11-21)

Alcance: API (`server/`), web (`web/`), base de datos, pagos, dependencias, historial de Git y variables de entorno.
Método: lectura del código, tests automáticos nuevos (22 en `server/test/security.test.ts` y `rate-limit.test.ts`),
ataques en vivo contra la API local con `curl` y prueba de la CSP en el navegador con la compilación de producción.

## Resumen

| área | estado antes | estado ahora |
| --- | --- | --- |
| Autenticación | Bien: JWT de Supabase verificado (emisor, audiencia, caducidad), `LOCAL_AUTH` bloqueado en producción | Igual + intentos fallidos registrados con alerta |
| Claves en el navegador | Bien: solo valores públicos en `config.json` | Igual (verificado) |
| Base de datos | Bien: RLS en las 18 tablas sin políticas; consultas parametrizadas | + conexión cifrada obligatoria en producción (`sslmode`) |
| HTTPS | HSTS por defecto (180 días) | Redirección 308 a HTTPS en producción, HSTS 1 año + subdominios, `APP_URL`/`PUBLIC_API_URL` https obligatorios |
| Cabeceras | helmet por defecto | API: CSP `default-src 'none'`, `frame-ancestors 'none'`, `no-referrer`, `X-Frame-Options: DENY`, `no-store`. Web: CSP estricta, Permissions-Policy, COOP |
| Límite de peticiones | Solo rutas con sesión | + límite global por IP (240/min), también en rutas públicas |
| Actividad sospechosa | No se registraba | Registro JSON (`{"sec": ...}`) + alerta al pasar el umbral |
| Pagos | Créditos solo vía webhook firmado | + el importe cobrado de un pack se compara con el precio |
| Errores | Sin pila al cliente | + JSON mal formado devuelve 400 (antes 500) |
| Dependencias | 0 vulnerabilidades en producción; 24 en herramientas de desarrollo | 0 en producción; 16 moderadas en la CLI de Angular (sin arreglo en la v21) |
| Secretos en Git | — | Historial limpio; nada que revocar |
| Gasto accidental | Los e2e podían usar el motor de pago | Los e2e se niegan a correr si el motor no es el de demostración |

## Lo que encontré y arreglé

1. **Rutas públicas sin límite de peticiones** (`/api/plans`, `/api/credit-packs`, `/api/capabilities`).
   - Arreglo: límite global por IP de 240 por minuto.
   - Test: la petición 241 devuelve 429 y otra IP no se ve afectada.
2. **Sin HTTPS obligatorio.**
   - En producción, cualquier petición por HTTP se redirige con 308 a `https://` (salvo `/health`, que usa el healthcheck interno).
   - HSTS de 1 año con subdominios.
   - La configuración no arranca si `APP_URL` o `PUBLIC_API_URL` no son https.
3. **La conexión a la base podía ir sin cifrar en producción.** La configuración exige `sslmode=require` (o
   `verify-full`) en `DATABASE_URL`.
4. **Clave de Stripe de prueba aceptada en producción** (cobraría «de mentira»). Ahora en producción hace falta `sk_live_`.
5. **Nada registraba la actividad sospechosa.**
   - Nuevo `lib/security-log.ts`: una línea JSON por evento, con la IP recortada (/24 y /48) y sin emails.
   - Eventos registrados: tokens inválidos, peticiones limitadas, firmas falsas (webhook y URLs de archivos), JSON roto y
     pagos que no cuadran.
   - Si una IP o un usuario pasa de 20 eventos del mismo tipo en 10 minutos, emite **una** línea `{"sec":"alert"}`.
6. **JSON mal formado daba 500** y ensuciaba el log de errores. Ahora es 400 `bad_json`.
7. **Cabeceras de la API mejorables.**
   - CSP `default-src 'none'` (la API no sirve HTML).
   - `frame-ancestors 'none'` y `X-Frame-Options: DENY`.
   - `Referrer-Policy: no-referrer` y `Cache-Control: no-store` en todo `/api`, para que los datos de cada usuario no
     queden en cachés.
8. **CORS devolvía el origen permitido a cualquiera.** El navegador ya lo bloqueaba, pero ahora un origen ajeno no
   recibe ninguna cabecera CORS.
9. **Web sin cabeceras de seguridad.**
   - `npm run build:prod` genera `_headers` (formato de Cloudflare Pages y Netlify) con una CSP construida con los
     orígenes reales de la API, Supabase y R2: `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'` y
     `upgrade-insecure-requests`.
   - También `X-Frame-Options`, `Permissions-Policy`, `COOP` y HSTS.
   - Quité el CSS crítico en línea de Angular, que usaba un `onload` en línea incompatible con la CSP.
   - La compilación de producción no lleva mapas de código.
10. **Packs: el webhook confiaba en el `pack_id` sin mirar el importe.** Ahora, si lo cobrado no coincide con el precio
    del pack, no se dan créditos y se registra `payment_mismatch`.
11. **Dependencias.**
    - vitest 2 → 5 (tenía una vulnerabilidad crítica en tinypool y una alta en vite).
    - Playwright → 1.65.1 (alta).
    - Servidor, web y e2e quedan con 0 vulnerabilidades en producción.
12. **Riesgo de gasto real en los tests** (incidente de hoy, abajo).
    - `e2e/global-setup.ts` se niega a ejecutar si la API usa el motor real.
    - Hay un lanzador `npm run dev:demo` y una preview `clon-tripo-api-demo` para los tests.

## Lo que comprobé y ya estaba bien

| petición | resultado |
| --- | --- |
| **Contraseñas con hash** | No hay contraseñas propias: el acceso es con enlace mágico o Google vía Supabase Auth, que guarda con bcrypt si algún día se activan. No hay tabla de contraseñas en nuestra base. |
| **Cookies de sesión** | No se usan cookies. El token va en la cabecera `Authorization`. El SDK de Supabase lo guarda en `localStorage`: por eso la CSP estricta es la defensa clave contra XSS. |
| **CSRF** | No aplica: sin cookies, otra web no puede hacer peticiones autenticadas en tu nombre, y CORS solo admite el origen de la app sin credenciales (comprobado). |
| **Validación en el servidor** | Todas las entradas pasan por esquemas zod. Los campos de más se descartan (un `credits` enviado por el cliente se ignora: el coste lo calcula el servidor). |
| **XSS** | Angular escapa todo lo que pinta. El único `bypassSecurityTrustHtml` pinta iconos del registro propio, nunca datos del usuario. Probado: un modelo llamado `<img src=x onerror=alert(1)><script>…` se ve como texto, sin ejecutar nada. |
| **Consultas parametrizadas** | Todas. Las cláusulas `where` dinámicas solo concatenan texto fijo y la búsqueda escapa `%` y `_`. Probado con `' or 1=1; drop table assets;--`. |
| **Rutas de administración** | No existen. `/api/dev/*` (acceso local de desarrollo) solo existe con `LOCAL_AUTH=1`, que la configuración prohíbe en producción. Probado: sin `LOCAL_AUTH` devuelve 404. La service role key de Supabase solo está en el servidor. |
| **Subidas** | Solo JPG, PNG y WEBP, hasta 20 MB. El tipo se comprueba por los bytes reales, no por la extensión, con un mínimo de 256 px. La URL de subida está firmada, caduca y lleva el tamaño firmado. Probado: un `.exe` renombrado a `.png` se rechaza al completar y una URL manipulada da 403. |
| **Precios y pagos en el servidor** | El precio sale de la base y de Stripe, nunca del cliente. Los créditos solo llegan por webhooks con firma verificada e idempotentes. |
| **Modo depuración** | En producción: `NODE_ENV=production`, sin pila en las respuestas, Angular en modo producción y sin mapas de código. El motor falso y el almacenamiento local están prohibidos en producción. |
| **Archivos expuestos** | Git solo versiona `server/.env.example` (sin valores). Ni `.env.local`, ni `.pgdata`, ni `.data`, ni Blender, ni `test-results`. La API no sirve archivos estáticos. |
| **Secretos en el historial** | Busqué en todo el historial claves de Stripe, AWS, GitHub, Google, JWT y claves privadas, y asignaciones de secretos con valor: nada. Tu `FAL_KEY` real no aparece en ningún commit ni en ningún otro archivo del proyecto. |
| **Claves comprometidas** | Ninguna comprometida: no hay nada que revocar ni cambiar. |
| **Paquetes sin usar** | Revisé todas las dependencias de servidor, web y e2e: todas se usan (algunas solo desde scripts o configuración). |
| **Variables de entorno** | Los secretos locales tienen 256 bits aleatorios, `.env.local` está ignorado y la configuración valida combinaciones peligrosas al arrancar. |

## Pruebas de las protecciones

**Automáticas: 71 tests del servidor en verde.** Las 22 de seguridad cubren:
- cabeceras;
- CORS;
- JWT: sin token, otra clave, caducado, emisor o audiencia falsos y `alg: none`;
- registro de seguridad y alerta;
- ausencia de rutas de desarrollo sin `LOCAL_AUTH`;
- JSON roto, cuerpo enorme, inyección SQL e id que no es UUID;
- webhook con firma falsa e importe de pack manipulado;
- redirección a HTTPS;
- 5 configuraciones de producción inseguras que se rechazan;
- recorte de IP y límite global.

**En vivo contra la API local:**
- Cabeceras correctas.
- CORS desde `https://evil.example` sin permiso.
- Sin token, token basura y `alg none`: 401.
- Inyección SQL tratada como texto.
- JSON roto: 400.
- `.exe` disfrazado: 422 al completar.
- URL firmada manipulada: 403.
- Ráfaga de 245 peticiones: 429 a partir de la 241, con cada evento en el log.

**En el navegador (compilación de producción con `_headers`):**
- Recorrido completo: portada, entrada, crear y ver un modelo 3D (GLB), progreso en vivo (SSE), mis modelos, precios
  y privacidad.
- **0 violaciones de CSP.**
- XSS con un nombre malicioso: se ve como texto, 0 ejecuciones.

**E2E: 30 de 30 en verde** contra la compilación de producción y la API de demostración.

## Incidente durante la revisión

Al ejecutar los e2e tras el cambio de precios, la API de desarrollo usaba el motor real (fal). Se lanzaron 17 tareas
reales:
- **10 llegaron a fal** (6 terminadas y 4 que quedaron huérfanas al reiniciarse la API): unos **3 $** de saldo;
- 7 se cancelaron en la cola antes de enviarse.

**Causa:** los e2e reutilizan la API que esté en marcha, sin comprobar el motor.

**Arreglo:** el freno de `global-setup.ts` y la API de demostración para los tests.

## Pendiente (necesita tus cuentas o una decisión)

**Al crear el proyecto de Supabase (Authentication → Settings):**
- Caducidad del enlace mágico (OTP): **15 minutos** (por defecto 1 hora) y de un solo uso (ya lo es).
- **URL Configuration:**
  - Site URL = tu dominio;
  - Redirect URLs = solo tu dominio (sin comodines), contra redirecciones abiertas.
- **Rate limits de email:** déjalos activados.
- Si algún día activas contraseña: longitud mínima 10 y «leaked password protection».

**Hosting de la web:**
- Publica `dist/web/browser` con el `_headers` generado por `npm run build:prod`, con
  `STORAGE_ORIGIN=https://<cuenta>.r2.cloudflarestorage.com`.
- Si el hosting no lee `_headers`, copia esas cabeceras en su configuración.

**Alertas:** conecta en el hosting una alerta sobre las líneas `"sec":"alert"`, por ejemplo con Better Stack o Axiom.

**OneDrive:** el proyecto vive en OneDrive, así que `server/.env.local` (con tu `FAL_KEY`) se sincroniza con tu nube.
Para producción, los secretos irán en el gestor del hosting, no en archivos.

**Auto-recarga de fal** con un tope bajo: limita el daño de cualquier fuga o abuso.

**CLI de Angular:** 16 avisos moderados en dependencias internas de npm, solo en desarrollo. Se arreglan al subir a
Angular 22.

**Sesión en `localStorage`** (SDK de Supabase): la CSP mitiga el riesgo. La alternativa, con cookies `httpOnly`
mediante un backend propio de sesión, es un cambio mayor; valorarlo si la app maneja datos más sensibles.
