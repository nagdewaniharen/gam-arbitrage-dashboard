# Contributing

## Branching

- `main` — always deployable; protected, requires PR.
- Feature branches: `feat/<short-description>`
- Fix branches: `fix/<short-description>`
- Chore branches: `chore/<short-description>`

## Pull Request checklist

Before opening a PR:

- [ ] `pnpm install` runs cleanly.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `pnpm build` passes.
- [ ] You ran the change locally end-to-end at least once.
- [ ] Touched files are scoped to the PR's stated purpose (no drive-by refactors).
- [ ] New env vars are added to `.env.example` with a comment.
- [ ] New API endpoints have Fastify JSON Schemas (so OpenAPI updates automatically).
- [ ] New UI components have at least a basic Storybook story (from Phase 2 onward).
- [ ] If you migrated the DB, the migration is committed inside `packages/db/prisma/migrations/`.

## Commit messages

Use plain, present-tense, descriptive messages:

```
add hourly cron handler for GAM report pull
fix off-by-one in date range parser
chore: bump prisma to 5.20
```

No strict Conventional Commits requirement in this repo (per project decision).

## Code style

- Prettier + ESLint are authoritative. If they disagree with you, they win.
- TypeScript `strict: true` — no `any` without a comment explaining why.
- Prefer named exports.
- Files: kebab-case (`report-job-runner.ts`). Components: PascalCase (`KpiCard.tsx`).

## Adding an API endpoint

1. Add a route file under `apps/api/src/routes/`.
2. Define `schema: { querystring, params, body, response }` so Fastify validates and Swagger docs the endpoint.
3. Register the route in `apps/api/src/routes/index.ts`.
4. Smoke-test against `http://localhost:4000/docs`.

## Adding a UI component

1. Add it under `apps/web/components/`.
2. Use Tailwind utilities; reach for shadcn/ui primitives first.
3. From Phase 2 onward, add a Storybook story next to the component file.

## Database changes

1. Edit `packages/db/prisma/schema.prisma`.
2. Run `pnpm db:migrate` — give the migration a descriptive name.
3. Commit the generated migration folder.
4. If the change is destructive, write the migration manually and explain it in the PR.

## Secrets

Never. Commit. Secrets. If a secret is leaked, rotate it immediately and notify the team. `.gitignore` covers the common cases but is not foolproof.
