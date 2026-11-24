# Desplegar My3DStudio en Oracle Cloud Always Free

Objetivo: la app en internet **sin pagar servidor**. Lo único que cuesta dinero es el dominio (≈ 10 €/año) y cada
modelo que se genera en fal (≈ 0,28 €), que pagan los clientes por adelantado con créditos.

| pieza | dónde | coste |
| --- | --- | --- |
| API, trabajador, base de datos y archivos | VM ARM de **Oracle Cloud Always Free** con Docker | 0 € |
| Entrada a la API sin abrir puertos | **Cloudflare Tunnel** | 0 € |
| Web | **Cloudflare Pages** | 0 € |
| Acceso (email + Google) | **propio** (Better Auth en tu Postgres) | 0 € |
| Emails de acceso | **Resend** (3.000/mes) | 0 € |
| Dominio | **Cloudflare Registrar** | ≈ 10 €/año |
| Generar modelos | fal.ai, con saldo prepago **sin auto-recarga** | lo pagan los créditos |

Lo que tienes que hacer tú (crear cuentas, comprar el dominio, poner saldo) está marcado con **[tú]**. Nada de esto
lo puede hacer Claude por ti.

## 1. Oracle Cloud: la máquina

1. **[tú]** Crea la cuenta en [cloud.oracle.com](https://www.oracle.com/cloud/free/). Pide tarjeta solo para
   verificar; no se cobra mientras uses recursos «Always Free». Elige como región de inicio una de la UE
   (por ejemplo Frankfurt o Madrid): no se puede cambiar después.
2. **[tú]** Compute → Instances → Create instance:
   - Image: **Canonical Ubuntu 24.04**.
   - Shape: **Ampere (VM.Standard.A1.Flex)** con **2 OCPU y 12 GB**, que es el máximo gratis desde agosto de 2026.
   - Boot volume: 100 GB (el límite gratis total es 200 GB).
   - Añade tu clave SSH pública (o deja que Oracle genere una y guárdala).
   - Si sale «Out of capacity», prueba otro dominio de disponibilidad o vuelve a intentarlo más tarde.
3. **No abras puertos** en la «Security List»: el túnel de Cloudflare sale desde la máquina y no necesita ninguno.
   Deja solo el 22 (SSH), y mejor restringido a tu IP.
4. Entra por SSH (`ssh ubuntu@IP_PUBLICA`) e instala Docker:

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker ubuntu && newgrp docker
git clone https://github.com/ffalaguera/My3DStudio.git && cd My3DStudio
```

Oracle puede **recuperar instancias gratuitas inactivas** (uso de CPU muy bajo durante días). Si pasa, el disco
se conserva y puedes volver a crear la instancia. Haz copias de seguridad (paso 9).

## 2. Dominio en Cloudflare

1. **[tú]** Crea una cuenta gratuita en [Cloudflare](https://dash.cloudflare.com).
2. **[tú]** Domain Registration → Register: compra el dominio (≈ 10 €/año a precio de coste, sin subidas al renovar).
   Mira antes [brand.md](brand.md): `my3dstudio.com` está ocupado.

## 3. Túnel: publicar la API sin abrir puertos

1. **[tú]** Cloudflare → Zero Trust (plan gratis) → Networks → Tunnels → Create a tunnel → Cloudflared.
2. Copia el **token** del túnel (lo pondrás en `TUNNEL_TOKEN`).
3. Public Hostname: `api.tudominio.com` → Service `HTTP` → `api:8787` (el nombre del servicio de Docker).

Cloudflare pone HTTPS delante y manda `X-Forwarded-Proto: https`, así que la API sabe que la petición llegó cifrada.

## 4. Email: Resend

1. **[tú]** Cuenta gratuita en [resend.com](https://resend.com) → Domains → añade `tudominio.com` y crea los
   registros DNS que te pide en Cloudflare (SPF y DKIM). Espera a que salga «Verified».
2. API Keys → crea una con permiso solo de envío → `RESEND_API_KEY`.

## 5. Google (opcional)

Sin esto se entra solo con enlace por email, que ya funciona.

1. **[tú]** [console.cloud.google.com](https://console.cloud.google.com) → APIs y servicios → Pantalla de
   consentimiento (externa, solo email y perfil).
2. Credenciales → Crear → ID de cliente de OAuth → Aplicación web:
   - Orígenes de JavaScript autorizados: `https://tudominio.com`.
   - No hace falta URI de redirección: la web usa el botón oficial de Google y la API verifica el token.
3. Copia el Client ID y el secreto → `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.

## 6. fal.ai: el freno de gasto

1. **[tú]** En fal, **desactiva la auto-recarga** y deja un saldo pequeño. Ese saldo es lo máximo que puedes gastar.
2. La app añade dos frenos más:
   - **Nadie genera sin haber pagado:** no hay plan gratis ni reintentos gratis.
   - **`GENERATION_DAILY_LIMIT`** (20 por defecto, ≈ 5,60 €/día): pasado ese número, las tareas esperan al día
     siguiente y en el log aparece `"sec":"budget_reached"`.
3. Recarga fal con lo que hayas cobrado en Stripe.

## 7. Arrancar la API

En el servidor:

```bash
cp deploy/oracle/.env.production.example deploy/oracle/.env.production
nano deploy/oracle/.env.production
```

Rellena los valores. Cada secreto (`POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `FILE_URL_SECRET`) se genera con
`openssl rand -hex 32`.

```bash
docker compose --env-file deploy/oracle/.env.production -f deploy/oracle/docker-compose.yml up -d --build
docker compose -f deploy/oracle/docker-compose.yml logs -f api
```

- La primera construcción tarda: instala Blender desde Ubuntu.
- La API aplica las migraciones al arrancar.
- Comprueba `https://api.tudominio.com/health` → `{"ok":true}`.

Seguridad incluida, sin tocar nada:
- La API no arranca en producción con HTTP, con claves de Stripe de prueba ni con el acceso de desarrollo.
- La base de datos y los archivos solo son accesibles dentro de Docker.
- Los archivos se sirven con URLs firmadas que caducan.

## 8. La web en Cloudflare Pages

1. **[tú]** Cloudflare → Workers & Pages → Create → Pages → conecta el repositorio de GitHub.
   - Build command: `npm ci && npm run build:pages`.
   - Root directory: `web`.
   - Build output: `dist/web/browser`.
   - Variables de entorno: `PUBLIC_API_URL=https://api.tudominio.com` y, si activaste Google, `GOOGLE_CLIENT_ID`.
2. `build:pages` escribe el `config.json` de producción (`auth: self`) y el `_headers` con la CSP y las cabeceras de
   seguridad, que Pages aplica solo.
3. Custom domains → `tudominio.com`.

## 9. Copias de seguridad

Cada noche, en el servidor (`crontab -e`):

```bash
0 4 * * * docker exec my3dstudio-db-1 pg_dump -U my3dstudio my3dstudio | gzip > ~/backups/db-$(date +\%F).sql.gz
```

Guarda copias fuera de la máquina de vez en cuando: por ejemplo, descárgalas con `scp`. Oracle no garantiza
la máquina gratis para siempre.

## 10. Pagos (cuando quieras cobrar)

Ver [launch/pricing.md](launch/pricing.md) §5. Resumen:
1. **[tú]** Crea la cuenta de Stripe (sin cuota fija) y los productos.
2. Rellena las `STRIPE_*` y reinicia con el mismo `docker compose … up -d`.
3. Ejecuta el seed para enlazar los precios: `docker compose … exec api npm run seed`.
4. Webhook a `https://api.tudominio.com/api/webhooks/stripe` con los eventos de pricing.md, más
   `charge.dispute.created`, `radar.early_fraud_warning.created` y `charge.refunded` (antifraude).

Antes de cobrar, consulta con un gestor el alta de autónomo.

## Comprobación final

- [ ] `https://api.tudominio.com/health` responde `{"ok":true}`.
- [ ] En `https://tudominio.com` → Entrar → email → llega el enlace → se entra (caduca a los 10 minutos y sirve una vez).
- [ ] Una cuenta nueva tiene 0 créditos y, al generar, ve el aviso de comprar.
- [ ] En fal, la auto-recarga está desactivada.
- [ ] Los logs de la API no muestran errores: `docker compose … logs api | grep -i error`.
