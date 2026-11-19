# ADR-002 — Phase 0 runtime foundation
Date: 2026-11-19. Status: Accepted for foundation (not a production-ready DB model).

## Context
Initial NestJS bootstrap returned 200 readiness without querying PostgreSQL; tests could pass with no tests and CI did not run tests or lint.

## Decisions
- Use `pg` connection pool for lightweight PostgreSQL infrastructure health/readiness. Liveness is process-only; readiness performs `SELECT 1` and returns 503 on unavailable DB.
- Validate NODE_ENV, PORT, DATABASE_URL, DB_CONNECT_TIMEOUT_MS and exact CORS_ORIGINS before application startup. No secret logging or committed production credentials.
- Centralize HTTP setup, request correlation IDs, safe error envelope and standard input validation.
- Run genuine Jest unit and PostgreSQL integration tests in CI; don't allow `--passWithNoTests`.
- Retain Modular Monolith and stable `/api/v1`. Do not claim an OpenAPI draft endpoint is live.

## Database evolution
`pg` only covers the connection foundation. A dedicated database ADR **must be approved before the first persistent feature** to select a typed query library and migration runner, define migration rollback/seed and tenant scoping patterns, and add a reproducible dependency lockfile. No production DB schema, migrations or auth is implemented in this change.

## Rollback
Revert this branch's commit; no database schema changes were made.

## Validation
Local dependency installation and runtime tests require an environment with access to npm and PostgreSQL. CI is configured to perform these checks on PR; results must be examined before merge.
