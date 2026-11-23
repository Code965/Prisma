# Server di Prisma da solo, per chi vuole le uscite anche a PC spento (VPS, NAS, Raspberry).
# Immagine pubblicata con ogni release: ghcr.io/code965/prisma-server (vedi docs/server-docker.md).

FROM node:24-slim AS build
WORKDIR /repo
RUN npm install -g pnpm@10.34.9
COPY . .
RUN pnpm install --frozen-lockfile --filter "@prisma-app/server..."
RUN pnpm --filter @prisma-app/server embed && pnpm --filter @prisma-app/server build

FROM node:24-slim
LABEL org.opencontainers.image.source=https://github.com/Code965/Prisma \
      org.opencontainers.image.description="Server di Prisma (social studio) sempre acceso" \
      org.opencontainers.image.licenses=AGPL-3.0-only
WORKDIR /app
# Un solo file con tutte le dipendenze, migrazioni e prompt compresi.
COPY --from=build /repo/apps/server/dist/index.js ./index.js
RUN mkdir /data && chown node:node /data
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    DATABASE_PATH=/data/prisma.db
VOLUME ["/data"]
EXPOSE 4000
USER node
CMD ["node", "index.js"]
