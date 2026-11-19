# API y trabajador de Forma, con Blender para exportar FBX y USDZ.
#   docker build -t forma-server .
#   docker run --env-file .env.production -p 8787:8787 forma-server
# Un mismo contenedor sirve de API (RUN_WORKER=0) o de trabajador (RUN_WORKER=1), según el entorno.
FROM node:24-bookworm-slim

ARG BLENDER_VERSION=4.5.16
ARG BLENDER_SHA256=23432b064977908beb1ab4b7f32f024e7331105c875c187dce002aff84b10c11

# Librerías que necesita Blender en modo sin interfaz (-b)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl xz-utils libgl1 libegl1 libxi6 libxkbcommon0 libsm6 libxrender1 libxxf86vm1 libxfixes3 \
  && rm -rf /var/lib/apt/lists/*

# Blender oficial, verificado con la suma SHA-256 publicada en download.blender.org
RUN curl -fsSL -o /tmp/blender.tar.xz \
      "https://download.blender.org/release/Blender${BLENDER_VERSION%.*}/blender-${BLENDER_VERSION}-linux-x64.tar.xz" \
  && echo "${BLENDER_SHA256}  /tmp/blender.tar.xz" | sha256sum -c - \
  && mkdir -p /opt/blender \
  && tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 \
  && rm /tmp/blender.tar.xz \
  && /opt/blender/blender -b --factory-startup --python-expr "import bpy; print('blender ok', bpy.app.version_string)"

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations

ENV NODE_ENV=production \
    PORT=8787 \
    BLENDER_PATH=/opt/blender/blender

USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/main.ts"]
