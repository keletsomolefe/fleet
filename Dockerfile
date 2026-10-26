# syntax=docker/dockerfile:1
FROM node:24.22.1-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/gateway/package.json ./apps/gateway/
RUN --mount=type=cache,id=fleet-build,target=/pnpm/store pnpm install --frozen-lockfile --store-dir=/pnpm/store

FROM dependencies AS build
COPY apps/api ./apps/api
COPY apps/web ./apps/web
COPY apps/gateway ./apps/gateway
COPY watt.json ./
ENV PLT_SERVER_LOGGER_LEVEL=warn PLT_MANAGEMENT_API=false PLT_SERVER_HOSTNAME=0.0.0.0 GATEWAY_PORT=3042
RUN pnpm test && pnpm typecheck && pnpm build

FROM base AS runtime
RUN install -d -o node -g node /app /pnpm /home/node/.cache
USER node
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/api/package.json ./apps/api/
COPY --chown=node:node apps/web/package.json ./apps/web/
COPY --chown=node:node apps/gateway/package.json ./apps/gateway/
RUN --mount=type=cache,id=fleet-runtime,target=/pnpm/store,uid=1000,gid=1000 pnpm install --frozen-lockfile --prod --store-dir=/pnpm/store
COPY --chown=node:node --from=build /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node --from=build /app/apps/web/.output ./apps/web/.output
COPY --chown=node:node apps/api/watt.json ./apps/api/watt.json
COPY --chown=node:node apps/web/watt.json ./apps/web/watt.json
COPY --chown=node:node apps/gateway/watt.json ./apps/gateway/watt.json
COPY --chown=node:node watt.json ./
COPY --chown=node:node deploy/bootstrap-owner.mjs ./deploy/bootstrap-owner.mjs
ENV NODE_ENV=production
ARG RELEASE_SHA=development
ENV FLEET_RELEASE_SHA=$RELEASE_SHA
LABEL org.opencontainers.image.source=https://github.com/keletsomolefe/fleet org.opencontainers.image.revision=$RELEASE_SHA org.opencontainers.image.title=Fleet
HEALTHCHECK --interval=20s --timeout=10s --start-period=40s --retries=5 CMD node -e "Promise.all(['/api/','/design/monogram.svg'].map(p=>fetch('http://127.0.0.1:3042'+p))).then(rs=>process.exit(rs.every(r=>r.ok)?0:1)).catch(()=>process.exit(1))"
EXPOSE 3042 1884
CMD ["node_modules/.bin/wattpm", "start"]
