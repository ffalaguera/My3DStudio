# My3DStudio

Aplicación web que convierte una imagen o un texto en un modelo 3D con texturas, listo para ver en el navegador y
descargar en GLB, OBJ, STL, FBX, USDZ o 3MF. Funciona con créditos y planes de suscripción.

> Nombre de producto provisional en el código: **Forma**.

## Qué hace

- **Imagen a 3D**: subes un JPG, PNG o WEBP (hasta 20 MB) y obtienes un modelo texturizado.
- **Texto a 3D**: el texto se traduce al inglés, se genera una imagen con FLUX.1 schnell y de ahí el modelo.
- **Dos modos**: alta calidad (malla densa) o malla optimizada con control del número de polígonos y variantes.
- **Visor 3D** con órbita, zoom, iluminación, vista de malla y captura.
- **Exportación** a GLB, OBJ, STL y 3MF en el servidor; FBX y USDZ con Blender sin interfaz.
- **Cola de tareas** con progreso en directo (SSE), cancelación y reintentos.
- **Créditos**: se congelan al empezar y se devuelven si la tarea falla; saldo mensual y movimientos.
- **Planes** Gratis / Pro / Max con Stripe Checkout, portal de cliente y webhooks.
- **Mis assets**: biblioteca con búsqueda, filtros, privacidad por modelo y borrado.

## Tecnología

| Parte | Stack |
| --- | --- |
| Frontend (`web/`) | Angular 21 (standalone + signals), Tailwind 3, three.js |
| API y trabajador (`server/`) | Node 24, Express 5, TypeScript (tsx), zod, pg-boss |
| Base de datos | PostgreSQL (Supabase en producción; Postgres embebido en desarrollo) |
| Motor 3D | [TRELLIS.2](https://github.com/microsoft/TRELLIS) en [fal.ai](https://fal.ai) |
| Auth / pagos / email / archivos | Supabase Auth, Stripe, Resend, Cloudflare R2 |
| Tests | Vitest (servidor), Playwright + axe (extremo a extremo) |

## Estructura

```
web/       Frontend Angular (config de ejecución en public/config.json)
server/    API REST + SSE, trabajador de la cola, migraciones SQL, Dockerfile
e2e/       Tests Playwright de los flujos principales y accesibilidad
replica/   Documentación: arquitectura, esquema, diseño, plan de tests, bugs, paridad
```

## Arrancar en local

Requisitos: **Node 24** y npm. No hacen falta cuentas externas: Postgres embebido, archivos en disco, acceso sin
contraseña, email por consola y un motor falso que genera objetos procedurales.

1. Instala dependencias:

   ```bash
   npm --prefix server ci
   npm --prefix web ci
   ```

2. Crea `server/.env.local` a partir de `server/.env.example` con, como mínimo:

   ```ini
   DATABASE_URL=postgres://postgres:postgres@localhost:54329/forma
   LOCAL_AUTH=1
   LOCAL_JWT_SECRET=<cadena aleatoria de 32+ caracteres>
   FILE_URL_SECRET=<otra cadena aleatoria de 32+ caracteres>
   GENERATION_PROVIDER=fake
   ```

3. En tres terminales:

   ```bash
   npm --prefix server run db:local    # Postgres embebido en el puerto 54329
   npm --prefix server run dev         # API en http://localhost:8787 (aplica migraciones)
   npm --prefix web start -- --port 4300
   ```

4. (Opcional) Datos de ejemplo: `npm --prefix server run seed`. "Continuar con Google" en local entra como
   `demo@example.com`.

Abre http://localhost:4300.

### Motor real y exportaciones

- **Generación real**: `GENERATION_PROVIDER=fal` y tu `FAL_KEY` (fal.ai → Dashboard → API Keys). Cada modelo cuesta
  unos $0,30 en fal.
- **FBX y USDZ**: `BLENDER_PATH` apuntando al ejecutable de Blender 4.5 LTS. Sin él, esos formatos no aparecen.

Todas las variables están explicadas en [`server/.env.example`](server/.env.example) y la configuración del frontend en
[`web/public/config.example.json`](web/public/config.example.json).

## Tests

```bash
npm --prefix server test   # Vitest sobre un Postgres embebido nuevo en cada ejecución
npm --prefix e2e ci && npm --prefix e2e test   # Playwright (Edge); arranca base, API y web si no están en marcha
```

## Despliegue

`server/Dockerfile` construye una imagen con Node 24 y Blender 4.5 LTS (verificado por SHA-256). La misma imagen sirve
de API (`RUN_WORKER=0`) o de trabajador (`RUN_WORKER=1`):

```bash
docker build -t my3dstudio-server server
docker run --env-file .env.production -p 8787:8787 my3dstudio-server
```

El frontend se compila con `npm --prefix web run build` y se sirve como sitio estático.

## Estado

Hechas 18 de las 20 funciones imprescindibles. Faltan probar el login real (Supabase + Google) y los pagos con claves
de Stripe. Detalle en [`replica/backend.md`](replica/backend.md) y [`replica/parity.md`](replica/parity.md).

## Licencias de terceros

El motor usa los pesos de TRELLIS.2 (MIT) y FLUX.1 schnell (Apache 2.0) a través de fal.ai. La revisión de licencias
está en [`replica/backend.md`](replica/backend.md#licencias-para-revisión-legal).

## Licencia

© Fernando. Todos los derechos reservados. El código es visible, pero no se concede permiso para usarlo, copiarlo ni
redistribuirlo.
