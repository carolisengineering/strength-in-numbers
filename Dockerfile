# Spec 01 §11 (Q4) — multi-stage. The same image runs in docker-compose, on
# Render, and (Spec 15) on ECS Fargate.

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH="/pnpm:$PATH"
# openssl: Prisma's query engine needs it (node:22-slim omits it → the engine
# picks the wrong libssl target and fails to load). ca-certificates: TLS to Neon.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
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
COPY apps/api/prisma ./apps/api/prisma
RUN pnpm install --prod --frozen-lockfile
# Generate the Prisma client explicitly. pnpm + monorepo layouts don't reliably
# fire @prisma/client's postinstall generation, and the build stage's client
# isn't copied here. `prisma` is a prod dep, so the CLI is available. DATABASE_URL
# is only needed at runtime, not to generate — a placeholder satisfies the parser.
RUN DATABASE_URL="postgresql://placeholder" pnpm --filter @sin/api exec prisma generate
# @sin/api now imports @sin/core (Spec 03.0). The workspace symlink resolves to
# packages/core/dist, so the compiled core output must be present in the runtime
# image alongside the api dist.
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist

RUN useradd --system --uid 1001 --home-dir /app appuser \
  && chown -R appuser:appuser /app
USER appuser

EXPOSE 3000
# Compose overrides this to also run `prisma migrate deploy` first.
CMD ["node", "apps/api/dist/server.js"]
