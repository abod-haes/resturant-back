# Phase 0 implementation status — 2026-11-19

## Delivered and checked in pull requests
- Typed runtime config, safe HTTP errors/requestId, correct PostgreSQL readiness and shutdown.
- CI runs architecture, TypeScript, lint, unit, integration and build. Earlier Phase 0 foundation PR #1 has passed CI and merged.
- **Core database foundation (in progress until CI succeeds)**: PostgreSQL SQL migration runner with checksums/advisory locking, first relational schema (users/restaurants/branches/plans/subscriptions/audit), typed Kysely query client and schema constraint integration tests.

## Not yet implemented
- Fully working authentication, password/session rotation, RBAC guards and application-level tenant query scoping.
- Business CRUD endpoints, DTO/generated OpenAPI, production plan rules and outbox.
- Safe primary admin bootstrapping; no hardcoded credentials or placeholder seeds will be committed.
- Staging/production backups and migration rehearsal, committed dependency lockfile and cross-repository integration smoke test.

## Verification
CI must be green on each pull request before review/merge. A passing CI test does not mean auth/business feature completeness.
