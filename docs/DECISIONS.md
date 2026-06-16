# Architectural Decision Log

We record significant decisions here so future maintainers (and outsourced contractors) can understand *why* the codebase looks the way it does.

Each ADR is a small, append-only record. Format:

```
## ADR-NNN — <title>
- **Date**: YYYY-MM-DD
- **Status**: Accepted | Superseded by ADR-XXX
- **Context**: what problem we faced
- **Decision**: what we chose
- **Consequences**: trade-offs we accepted
```

---

## ADR-001 — Fastify (not Express) for the backend
- **Date**: 2026-06-15
- **Status**: Accepted
- **Context**: PRD §12 said "developer's choice" between Node.js + Express and Node.js + FastAPI/Fastify. We needed a backend that's production-ready, outsource-friendly, and reduces the chance of broken API contracts.
- **Decision**: Use **Node.js 20 + Fastify 5 + TypeScript**.
- **Consequences**:
  - 2–3× higher throughput than Express.
  - JSON Schema on every route → automatic request/response validation + auto-generated OpenAPI/Swagger UI.
  - Built-in Pino logging.
  - Contractors must learn Fastify's plugin model (mild ramp).

## ADR-002 — Next.js (not vanilla JS/Alpine) for the frontend
- **Date**: 2026-06-15
- **Status**: Accepted
- **Context**: PRD §9.1 said "no framework required: Vanilla JS or lightweight (Alpine.js / Preact acceptable)". We want a stack any senior React contractor can jump into.
- **Decision**: **Next.js 15 (App Router) + React 19 + Tailwind v4 + shadcn/ui + TanStack Query + Recharts**.
- **Consequences**:
  - Heavier bundle than vanilla JS, but cached and SSR'd — well under the 2 s p95 budget.
  - Massive ecosystem; easy hiring.
  - Storybook-friendly component model.
  - Routes-as-files and server components reduce boilerplate.

## ADR-003 — PostgreSQL (not SQLite) from day 1
- **Date**: 2026-06-15
- **Status**: Accepted
- **Context**: PRD §12 suggested SQLite in dev → PG in prod. Migration later is wasted effort.
- **Decision**: **PostgreSQL 16 + Prisma ORM** in both dev and prod.
- **Consequences**:
  - One extra Docker container in local dev (negligible).
  - Concurrent writes (cron + manual refresh + API reads) just work.
  - Access to `citext`, `pgcrypto`, JSONB, window functions.
  - Production deploys to RDS without code change.

## ADR-004 — Monorepo with pnpm workspaces + Turborepo
- **Date**: 2026-06-15
- **Status**: Accepted
- **Context**: API and Web share types (`@gam/types`) and a DB layer (`@gam/db`). Splitting them into multiple repos creates type-sync drift.
- **Decision**: Single repo, three workspaces: `apps/api`, `apps/web`, `packages/{db,types}`. Builds orchestrated with **Turborepo**.
- **Consequences**:
  - One PR can change contract + producer + consumer atomically.
  - Cold-clone setup is slightly heavier (~1 GB node_modules).
  - Caching with Turbo keeps CI fast.

## ADR-005 — AWS as the deploy target (not Hetzner VPS)
- **Date**: 2026-06-15
- **Status**: Accepted (supersedes the Hetzner direction in PRD §12)
- **Context**: Original PRD specified a Hetzner VPS at `204.168.237.255`. Product owner switched to AWS for managed services and easier outsourcing handover.
- **Decision**: **Amplify (web) + App Runner (api) + RDS (db) + EventBridge (cron) + Secrets Manager + S3 + ECR + CloudWatch**.
- **Consequences**:
  - Higher monthly bill ($80–120) than a single VPS ($5–15) — accepted for the operational maturity.
  - No SSH/systemd/nginx setup needed; App Runner + Amplify are zero-touch deploys.
  - GitHub Actions deploys via OIDC; no long-lived keys.
  - Daily snapshots + PITR satisfy data-durability requirement explicitly stated by product owner.

## ADR-006 — Phase 1 access via private URL + Basic Auth at edge (no app-level login)
- **Date**: 2026-06-15
- **Status**: Accepted
- **Context**: PRD §11 said Phase 1 = "no auth, accessed via private URL". But the dashboard will be touched by outsourced contractors, so we want at least an edge-layer gate.
- **Decision**: Phase 1 enforces **HTTP Basic Auth via Amplify rewrite headers** in front of both the web app and the API. App-level SSO ships in Phase 2C.
- **Consequences**:
  - Trivial to configure (Amplify console + header).
  - Doesn't leak content if URL is shared.
  - One credential rotation needed when Phase 2C ships.

## ADR-007 — Google Workspace SSO via NextAuth (not Keycloak)
- **Date**: 2026-06-15
- **Status**: Accepted
- **Context**: Product owner suggested Keycloak as one option. We have a single app and an existing Google Workspace.
- **Decision**: **NextAuth (Auth.js v5) + Google OAuth provider, domain-restricted**. Roles in DB.
- **Consequences**:
  - Zero extra infra; ~2 hours to wire up.
  - Users managed entirely from Google Admin Console (deactivate Google account → loses dashboard access).
  - If we ever need centralized IdP for ≥ 3 apps, swap to Keycloak (or Cognito) without rewriting routes.

## ADR-008 — Multi-tenant ready, single-tenant in use
- **Date**: 2026-06-15
- **Status**: Accepted
- **Context**: Today we only serve River Five Global (network `23340025403`). Future may add networks.
- **Decision**: Every reporting row carries `network_id`. Today every query implicitly scopes to the single network; tomorrow we flip a config and add per-user network ACLs without a migration.
- **Consequences**:
  - One extra column on hot tables (cheap).
  - Single-tenant queries occasionally include redundant `WHERE network_id =` (negligible).

## ADR-009 — Recharts over Chart.js or hand-rolled CSS bars
- **Date**: 2026-06-15
- **Status**: Accepted
- **Context**: PRD §9.3.3 preferred CSS bars under the original "no framework" constraint. Now we have React.
- **Decision**: **Recharts** — composable React components, dark-theme friendly, tree-shakes to ~40 KB gzipped.
- **Consequences**:
  - Slightly larger bundle than CSS bars.
  - We don't reinvent axis rendering / tooltips.
  - Easy to add new chart types later (line, area) without re-architecting.

## ADR-010 — CSV upload as Phase 1 fallback, never removed
- **Date**: 2026-06-15
- **Status**: Accepted
- **Context**: GAM service account is in TL's hands and may take days. CSV upload was already in PRD §8.4 / §9.3.8 as a "fallback".
- **Decision**: CSV upload is **first-class**, not just a stopgap. Same parser is used by the GAM cron and by manual uploads, so improvements benefit both paths.
- **Consequences**:
  - One more endpoint to maintain — worth it.
  - Audits become possible: paste a CSV from GAM, see exactly which rows our cron would have inserted.
