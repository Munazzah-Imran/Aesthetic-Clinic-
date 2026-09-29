# Next.js + Docker + Postgres

A Next.js 15 (App Router, TypeScript, Tailwind v4) starter that runs in a Docker
container with a Postgres 17 database, wired together with Docker Compose.

## What's inside

- `src/app` — App Router pages and `/api/todos` REST routes
- `src/lib/db.ts` — singleton `pg` Pool (respects `DATABASE_URL`)
- `src/components/TodoList.tsx` — client component that reads/writes todos
- `docker/postgres/init.sql` — creates a `todos` table on first DB startup
- `Dockerfile` — multi-stage build → slim standalone production image
- `docker-compose.yml` — `app` + `db` services (prod-style)
- `docker-compose.dev.yml` — overlay with hot-reload dev server

## Quick start (production-style)

```bash
docker compose up --build -d
# app:  http://localhost:3000
# db:   localhost:5432 (postgres/postgres, database: appdb)
```

## Hot-reload development

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Or run the DB in Docker and Next.js on the host:

```bash
npm install
npm run db:up        # start only postgres
npm run dev          # uses .env → DATABASE_URL
```

## Useful commands

| Command | What it does |
| --- | --- |
| `npm run up` | Build + start app and db in the background |
| `npm run dev:docker` | Dev server in Docker with hot reload |
| `npm run down` | Stop the stack |
| `npm run down:clean` | Stop and **delete** the database volume |
| `npm run typecheck` | TypeScript check |

## Environment

Copy `.env.example` → `.env` when running outside Docker. Inside Docker the
compose file injects `DATABASE_URL=postgresql://postgres:postgres@db:5432/appdb`.
