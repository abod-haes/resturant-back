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

## Plans & Subscriptions v1.5.0 — PR #5
- Admin plans: create/list/get/patch with explicit boolean feature flags, numeric limits, audit and stable cursor pagination.
- Admin subscriptions: pending manual assignment, activation, renewal, immutable term snapshots, expiry/grace computation and audit.
- Owner: read current subscription and configured enabled renewal channels even when subscription is expired.
- No payments, card billing or automatic renewal. New plan limits do not retroactively alter the current term.
- The `SubscriptionsService.assertOperational` policy exists for future owner/employee/public operational routes, but branch/table/employee quota enforcement is **not integrated yet** because those CRUD routes do not exist. No production environment/staging client handshake claimed.

## Branches & Menu v1.6.0 — PR #8
- Owner branches list/create/detail/patch with tenant isolation and transactional maxBranches cap, including disabled branches.
- Category/product list/create/detail/patch and soft archive, priceMinor+currency, oldPriceMinor, tags, sold-out/visibility; cross-branch relational integrity.
- Secure CDN origin allowlist for HTTPS product-image references (no upload/transcode pipeline in this slice).
- Independent menu copy into an empty branch in the same restaurant, preserving category/product properties but issuing new IDs. Template/table copy intentionally deferred to QR/tables slice.
- Public menu and categories (paginated) show only published, in-scope records and expose no QR or staff-call credentials; subscription menu feature and grace checked server-side.
- Explicit DTO/Swagger contract v1.6 and dashboard handoff. Independent frontend adapters and staging smoke test NOT VERIFIED.
