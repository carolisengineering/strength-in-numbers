# Spec 01 §11 (Q4) — multi-stage. The same image runs in docker-compose, on
# Render, and (Spec 15) on ECS Fargate.

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH="/pnpm:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# ---- build: full install, generate client, compile TS ----
FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile
COPY packages/core ./packages/core
COPY apps/api ./apps/api
RUN pnpm --filter @sin/core build && pnpm --filter @sin/api build

# ---- runtime: prod deps + dist only, non-root ----
FROM base AS runtime
ENV NODE_ENV=production
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json ./packages/core/
COPY apps/api/package.json ./apps/api/
# Copy the schema first so @prisma/client's postinstall regenerates the client
# against it during the prod install.
COPY apps/api/prisma ./apps/api/prisma
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/apps/api/dist ./apps/api/dist

RUN useradd --system --uid 1001 --home-dir /app appuser \
  && chown -R appuser:appuser /app
USER appuser

EXPOSE 3000
# Compose overrides this to also run `prisma migrate deploy` first.
CMD ["node", "apps/api/dist/server.js"]
