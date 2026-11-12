# syntax=docker/dockerfile:1.7
#
# FitVision production images (multi-stage):
#   --target api   API server (also runs the worker and migrations with a different command)
#   --target web   Caddy: HTTPS, the built web app, and a reverse proxy to the API
#
# Pin base images by digest in your registry mirror for reproducible builds (see docs/DEPLOYMENT.md).
ARG NODE_IMAGE=node:22-bookworm-slim
ARG CADDY_IMAGE=caddy:2-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Dependency layer first, so code changes don't refetch packages.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --offline --frozen-lockfile
RUN pnpm --filter @fitvision/api build \
 && pnpm --filter @fitvision/web build \
 && pnpm --filter @fitvision/api deploy --prod --legacy /out/api \
 && rm -rf /out/api/src /out/api/test

FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]

FROM ${CADDY_IMAGE} AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/security-headers.caddy /etc/caddy/security-headers.caddy
COPY --from=build /repo/apps/web/dist /srv
