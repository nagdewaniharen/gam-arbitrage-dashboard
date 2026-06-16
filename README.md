# GAM Arbitrage Reporting Dashboard

Production-grade reporting dashboard for ad arbitrage operations on Google Ad Manager (GAM) + Ad Exchange (AdX). Pulls hourly revenue, impressions, eCPM, and performance breakdowns directly from the GAM Reporting API and visualizes them by **campaign × source × headline × lander × image × ad_unit × page**.

> Full product spec: [`docs/PRD.md`](./docs/PRD.md)
> Architecture: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
> Decisions (ADR log): [`docs/DECISIONS.md`](./docs/DECISIONS.md)

---

## Tech Stack

| Layer | Tech |
| --- | --- |
| Backend API | Node.js 20 + Fastify 5 + TypeScript |
| Frontend | Next.js 15 (App Router) + React 19 + Tailwind v4 + shadcn/ui |
| Database | PostgreSQL 16 + Prisma ORM |
| Charts | Recharts |
| Data fetching | TanStack Query (5-min auto-refresh) |
| Auth (Phase 2) | NextAuth + Google Workspace OAuth |
| Monorepo | pnpm workspaces + Turborepo |
| Containerization | Docker + docker-compose |
| Deploy target | AWS (Amplify + App Runner + RDS + EventBridge + Secrets Manager + S3) |
| CI/CD | GitHub Actions |
| API docs | Swagger UI at `/docs` |
| Component docs | Storybook |

## Repository layout

```
.
├── apps/
│   ├── api/                 Fastify backend (REST + GAM API client + cron handler)
│   └── web/                 Next.js dashboard UI
├── packages/
│   ├── db/                  Prisma schema, migrations, seed scripts
│   └── types/               Shared TypeScript types between web and api
├── infra/
│   └── docker/              Local-dev Docker assets (Postgres init, etc.)
├── docs/                    PRD, architecture, ADRs, runbooks
├── .github/workflows/       GitHub Actions CI/CD
├── docker-compose.yml       Local dev: postgres + api + web
├── package.json             Monorepo root
├── pnpm-workspace.yaml
└── turbo.json
```

## Prerequisites

- **Node.js 20** (use `nvm use` — `.nvmrc` is checked in)
- **pnpm 9+** — install with `npm install -g pnpm@9.12.0`
- **Docker Desktop** (for local Postgres)
- **AWS CLI** (for deployment only, not local dev)

## Local development — first run

```bash
# 1. Clone & install
git clone <repo-url>
cd GAM_Arbitrage_Reporting_Dashboard
pnpm install

# 2. Set up environment
cp .env.example .env
# Edit .env if needed (defaults work for local dev)

# 3. Start Postgres
pnpm docker:up

# 4. Generate Prisma client + run migrations + seed sample data
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# 5. Start everything in dev mode (API + Web concurrently)
pnpm dev
```

Then open:

- **Dashboard**: http://localhost:3000
- **API**: http://localhost:4000
- **Swagger UI**: http://localhost:4000/docs
- **Prisma Studio** (DB browser): `pnpm db:studio`

## Common commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run API + Web concurrently in dev mode |
| `pnpm build` | Build every workspace |
| `pnpm lint` | Lint every workspace |
| `pnpm typecheck` | TypeScript check across workspaces |
| `pnpm test` | Run all tests |
| `pnpm db:migrate` | Apply pending Prisma migrations |
| `pnpm db:seed` | Reset DB and seed with realistic sample data |
| `pnpm db:studio` | Browse the DB visually |
| `pnpm docker:up` | Start Postgres (and dockerized API/Web in `--profile full` mode) |
| `pnpm docker:down` | Stop and clean up containers |

## Environment variables

Every variable is documented in [`.env.example`](./.env.example). Production secrets live exclusively in **AWS Secrets Manager** and are never committed.

Critical local-dev variables:

| Var | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://gam:gam_dev_password@localhost:5432/gam_arbitrage` | Matches `docker-compose.yml` |
| `API_PORT` | `4000` | |
| `WEB_ORIGIN` | `http://localhost:3000` | CORS allowlist |
| `GAM_NETWORK_CODE` | `23340025403` | River Five Global |
| `GAM_SERVICE_ACCOUNT_JSON_PATH` | `./secrets/gam-service-account.json` | **Gitignored**; receive from TL via secure channel |

## GAM Service Account — handover to TL

The team lead (GAM admin) provisions the service account by following [`docs/RUNBOOK_GAM_SERVICE_ACCOUNT.md`](./docs/RUNBOOK_GAM_SERVICE_ACCOUNT.md). Output: a single `.json` file you drop into `./secrets/gam-service-account.json` for local dev, or upload to AWS Secrets Manager at `gam-arbitrage/gcp-service-account` for prod.

## Project status

| Phase | Status |
| --- | --- |
| 0 — Docs + scaffold + Docker + CI | ⏳ In progress |
| 1A — DB + API + CSV upload | ☐ |
| 1B — Dashboard UI | ☐ |
| 2A — GAM API integration | ☐ (blocked on TL service-account handover) |
| 2B — Cross-dim + Top/Bottom | ☐ |
| 2C — Google Workspace SSO + roles | ☐ |
| 3 — Cost / ROI + MGID API | ☐ |
| 4 — Slack alerts + date compare | ☐ |

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

Proprietary — internal tool. Do not distribute.
