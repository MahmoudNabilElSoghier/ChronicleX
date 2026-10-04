# ChronicleX — archiving platform built for TMG

Enterprise document archiving system for Talaat Moustafa Group (TMG).

Arabic-first, RTL-safe. Monorepo: NestJS API + Next.js 14 web + shared Zod schemas.

## Prerequisites (hard requirements)

- Node 20 LTS — HARD REQUIREMENT, use `.nvmrc` (`nvm use` / `fnm use`).
  Next.js 14.2 + NestJS 10 are only officially supported on Node 18/20.
  Node 22/24 will break native modules (argon2 in Phase 3) on Windows.
- pnpm 9 (via `corepack enable && corepack prepare pnpm@9 --activate`)
- Docker Desktop (local postgres / redis / minio) + Docker Compose v2
- Git

## Setup

```bash
# 1. infra (requires Docker Desktop)
docker compose config   # schema-validate the compose file
docker compose up -d
docker compose ps   # all 4 services healthy

# 2. env
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# 3. auth keys (RS256 — never commit PEMs)
pnpm keys:generate

# 4. install + dev
pnpm install
pnpm dev
```

- API: http://localhost:3001/health (liveness), http://localhost:3001/ready (readiness)
- Web: http://localhost:3000 → redirects to `/ar`
- MinIO console: http://localhost:9001 (bucket `chroniclex-archive`, versioning ON)

## Scripts (plain pnpm -r, no Turbo)

| Scope | dev | build | lint | typecheck |
|-------|-----|-------|------|-----------|
| root | `pnpm dev` | `pnpm build` | `pnpm lint` | `pnpm typecheck` |
| api | `pnpm --filter @chroniclex/api dev` | … `build` | … `lint` | … `typecheck` |
| web | `pnpm --filter @chroniclex/web dev` | … `build` | … `lint` | … `typecheck` |

## 12-factor

Config via env only (see `.env.example`). No secrets in repo. RS256 keys in `apps/api/keys/` (gitignored).
