# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8

FROM ${NODE_IMAGE} AS build
ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /workspace
RUN corepack enable
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter @lead-agent/api deploy --prod --legacy /deploy/api \
    && pnpm --filter @lead-agent/worker deploy --prod --legacy /deploy/worker \
    && pnpm --filter @lead-agent/migrator deploy --prod --legacy /deploy/migrator

FROM ${NODE_IMAGE} AS api
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision=${GIT_SHA} \
      org.opencontainers.image.source="https://github.com/mufazzalshokh/lead-agent-platform"
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node --from=build /deploy/api/ ./
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]

FROM ${NODE_IMAGE} AS worker
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision=${GIT_SHA} \
      org.opencontainers.image.source="https://github.com/mufazzalshokh/lead-agent-platform"
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node --from=build /deploy/worker/ ./
USER node
CMD ["node", "dist/index.js"]

FROM ${NODE_IMAGE} AS migrator
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision=${GIT_SHA} \
      org.opencontainers.image.source="https://github.com/mufazzalshokh/lead-agent-platform"
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node --from=build /deploy/migrator/ ./
USER node
CMD ["node", "dist/index.js"]

FROM ${NODE_IMAGE} AS web
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision=${GIT_SHA} \
      org.opencontainers.image.source="https://github.com/mufazzalshokh/lead-agent-platform"
ENV HOSTNAME=0.0.0.0 \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080
WORKDIR /app
COPY --chown=node:node --from=build /workspace/apps/web/.next/standalone/ ./
COPY --chown=node:node --from=build /workspace/apps/web/.next/static/ ./apps/web/.next/static/
USER node
EXPOSE 8080
WORKDIR /app/apps/web
CMD ["node", "server.js"]
