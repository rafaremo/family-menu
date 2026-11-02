# Family Menu — imagen de producción (Coolify u otro host con Docker).
# Sin paso de build: Remix 3 compila TS/JSX al vuelo (remix/node-tsx) y el asset server
# minifica el JS del navegador en producción.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    UPLOADS_DIR=/data/uploads \
    TRUST_PROXY=true

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .
# Solo se usa si no hay R2 configurado (fotos en disco → monta un volumen en /data/uploads).
RUN mkdir -p /data/uploads && chown -R node:node /data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

# 1) release: migraciones + catálogos + primer admin (idempotente)  2) servidor
CMD ["sh", "-c", "node --import remix/node-tsx scripts/release.ts && exec node --import remix/node-tsx server.ts"]
