# syntax=docker/dockerfile:1.7
# ---- deps ----
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules
COPY . .
RUN pnpm --filter @gam/db generate
RUN pnpm --filter @gam/api build

# ---- run ----
FROM node:20-alpine AS run
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/apps/api/dist ./dist
COPY --from=build --chown=app:app /app/apps/api/node_modules ./node_modules
COPY --from=build --chown=app:app /app/packages/db ./packages/db
COPY --from=build --chown=app:app /app/packages/types ./packages/types
COPY --from=build --chown=app:app /app/apps/api/package.json ./package.json
USER app
EXPOSE 4000
CMD ["node", "dist/apps/api/src/server.js"]
