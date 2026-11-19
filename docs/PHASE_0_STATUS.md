# Backend implementation status — 2026-11-19

## Merged foundation
- PR #1: typed runtime config, error envelope, PostgreSQL readiness and CI.
- PR #2: Kysely typed schema, transactional SQL migrations, checksum validation and tenant constraints.
- PR #3: Auth v1.3.0 login/refresh/logout/me/change-password, short-lived JWT, rotating session hash, audit, deny-by-default RBAC and tenant/branch authorization. Tests passed before merge.

## Restaurant onboarding v1.4.0 — PR #4
- Admin-only POST /admin/restaurants atomically creates restaurant, owner and first branch, writes audit and returns only identifiers.
- GET list uses stable keyset cursor, literal case-insensitive substring search, default 20 / max 100; GET detail returns first branch; PATCH name/active state audited.
- Username conflicts return 409 and roll back all records; owner must change initial password. No plan/subscription is automatically activated.
- Shared password and principal contracts in common/ avoid private cross-feature imports.
- Contract and dashboard handoff recorded in docs/RESTAURANT_DASHBOARD_HANDOFF.md. Actual client staging integration is NOT verified.

## Pending
- Platform-admin account management, plans and manual subscriptions/grace limits, owner branch/menu CRUD, employee shifts, QR, calls, push/outbox and reporting.
- Edge IP rate limits, production secret management, backup/restore drills, session cleanup, staging smoke tests and shared mock/live dashboard adapters.
- Pinned dependency lockfile and production container smoke verification.

## Quality
PR #4 runs DB migrations twice, checksum gate, architecture, typecheck, lint, Jest unit/integration against PostgreSQL 17 and build. Verify the completed PR run before merging; never claim deployed production readiness from PR CI alone.
