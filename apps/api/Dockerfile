# syntax=docker/dockerfile:1.7
# ---- deps ----
FROM node:20-slim AS deps
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml turbo.json tsconfig.base.json .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/
RUN pnpm install --frozen-lockfile
# ---- build ----
FROM node:20-slim AS build
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter @gam/db generate
RUN pnpm --filter @gam/types build
RUN pnpm --filter @gam/db build
# Prisma's generated client is plain JS — tsc won't emit it into dist, so copy it in
RUN cp -R packages/db/src/generated packages/db/dist/generated
RUN pnpm --filter @gam/api build
RUN pnpm --filter @gam/api deploy --prod /app/deploy
# ---- run ----
FROM node:20-slim AS run
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd -r app && useradd -r -g app app
COPY --from=build --chown=app:app /app/deploy ./
USER app
EXPOSE 4000
CMD ["node", "dist/server.js"]
