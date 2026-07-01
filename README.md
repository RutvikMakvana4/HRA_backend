# HRA Backend

**Stack:** NestJS 11 · Drizzle ORM · PostgreSQL · Redis · Amazon SQS · AWS (ECS Fargate).
**Architecture:** modular monolith (`src/modules/*`)

> **Status:** Phase 1 foundation. Module/schema folders are empty placeholders; kernel pieces are
> compiling stubs (no business logic yet).

---

## Prerequisites

- **Node 24 LTS** (`nvm use` reads `.nvmrc`)
- **pnpm 10** (`corepack enable` or `npm i -g pnpm`)
- **Docker** (for Postgres, Redis, LocalStack)

## Setup

```bash
nvm use                       # Node 24
pnpm install                  # exact, pinned versions
cp .env.example .env          # then edit as needed
pnpm up                       # start Postgres + Redis + LocalStack (docker compose)
```

## Run

```bash
pnpm dev                      # API in watch mode  → http://localhost:3000
pnpm worker                   # worker process (SQS consumers) in watch mode
curl http://localhost:3000/health
```

Production:

```bash
pnpm build
pnpm start                    # API   (node dist/main.js)
```

## Database / migrations

Workflow (rules §5.5): generate → **review the SQL** → migrate. Forward-only, committed,
never edited once shipped. Migrations apply as a **gated step**, not at app boot in prod.

```bash
pnpm db:generate              # drizzle-kit generate — REVIEW the emitted SQL
pnpm db:migrate               # apply migrations (gated)
pnpm db:check                 # fail if schema has un-generated drift (CI uses this)
pnpm db:studio                # drizzle studio
```

## Quality

```bash
pnpm lint                     # ESLint (flat config)
pnpm typecheck                # tsc --noEmit (strict)
pnpm test                     # Jest (unit + integration)
pnpm test:e2e
pnpm format                   # Prettier write
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, test, build, and the migration check on
every PR to `main`.

## Layout

```
src/
  common/      kernel: config, guards, interceptors, filters, ledger, uow, outbox, audit
  db/          drizzle client (DRIZZLE provider), schema/ (one file per domain), relations, migrations
  redis/       ioredis provider, lock + cache helpers
  sqs/         SQS client provider
  modules/     one folder per domain (auth, employees, leave …) — empty stubs
  jobs/        cron definitions
  health/      GET /health
  main.ts      API entrypoint
  worker.ts    worker entrypoint
```
