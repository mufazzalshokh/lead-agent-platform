# Lead Agent Platform

Production-oriented workspace foundation for the multi-tenant AI lead-to-booking platform.
The repository is currently at **Stage 1: Workspace Baseline**. It contains buildable
application shells and package boundaries, but no lead, conversation, booking, tenant,
database, authentication, provider, or AI behavior.

## Prerequisites

- Node.js `24.14.0` (see `.node-version`)
- Corepack
- pnpm `11.24.0` (declared by `packageManager`)

Enable the repository package manager and install from the lockfile:

```sh
corepack enable
pnpm install --frozen-lockfile
```

## Applications

- `@lead-agent/web`: minimal Next.js page at `http://localhost:3000`
- `@lead-agent/api`: minimal Fastify service with `GET /health` on port `3001`
- `@lead-agent/worker`: executable Node.js worker shell with no registered jobs

Run all three development processes:

```sh
pnpm dev
```

The API accepts optional `HOST` and `PORT` process settings documented in `.env.example`.
No environment loader or secret-bearing configuration is included.

## Commands

| Command                 | Purpose                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `pnpm dev`              | Build package shells and run all application development processes |
| `pnpm build`            | Produce package and application production builds                  |
| `pnpm lint`             | Run ESLint with zero warnings allowed                              |
| `pnpm lint:fix`         | Apply safe ESLint fixes                                            |
| `pnpm format`           | Format Stage 1 source and configuration files                      |
| `pnpm format:check`     | Verify formatting without changing files                           |
| `pnpm boundaries:check` | Enforce workspace dependency direction and cycle rules             |
| `pnpm typecheck`        | Typecheck root tests, packages, and applications                   |
| `pnpm test`             | Run Vitest in watch mode                                           |
| `pnpm test:run`         | Run deterministic tests once                                       |
| `pnpm clean`            | Remove only known generated build and test artifacts               |
| `pnpm ci:verify`        | Run the complete clean Stage 1 verification gate                   |

## Workspace structure

```text
apps/       Next.js, Fastify, and worker composition shells
packages/   Architecture-owned package entry points
scripts/    Safe cleanup and dependency-boundary enforcement
tests/      Workspace configuration and boundary regression tests
infra/      Deferred infrastructure scope marker; no infrastructure is implemented
docs/       Accepted Stage 0 architecture package
```

Workspace scripts use pnpm's native recursive and filtered execution. Turborepo is not
included because Stage 0 does not approve an additional build orchestrator and the current
workspace does not require one.

## Scope boundary

Stage 2 contracts, domain behavior, persistence, tenancy enforcement, authentication, AI,
external providers, queues, deployment artifacts, and product UI are intentionally deferred
to their approved roadmap stages.
