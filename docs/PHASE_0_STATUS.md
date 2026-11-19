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

## Tables & QR v1.7.0 — PR #9
- Floor/area/table CRUD, soft archive with strict dependency checks, and tenant/branch foreign keys. A disabled table still uses plan quota; archived tables release quota.
- Concurrency-safe table quota and 1-50 bulk creation in one PostgreSQL transaction; partial bulk writes are rolled back.
- Per-table stable URL on rename or area move; 256-bit random QR token, SHA-256 lookup and AES-256-GCM encrypted stored credential. Rotation immediately invalidates old QR URLs and preserves disabled state; QR disable/reenable explicit.
- Public table context lookup is read-only; no visit sessions or staff calls yet. General menu remains non-table URL.
- A4 PDF QR sticker generation with maximum 100 labels per request; print currently uses an ID fallback for Arabic text due to built-in Helvetica glyph limitations.
- Requires secure Dokploy environment QR_TOKEN_ENCRYPTION_KEY and CUSTOMER_APP_ORIGIN for issuing, rotating, and printing QR codes. Backend does not need them for other modules.
- Dashboard/client/staging end-to-end handshake and server deployment NOT YET VERIFIED.

## QR visits, calls, workforce v1.8.0 — PR #10
- 256-bit opaque QR visit session, SHA-256 storage, 4-hour sliding idle expiry, heartbeat, per-table admission rate limit and revocation on QR rotation.
- First-call confirmation, per-table/type cooldown 10 seconds, atomic idempotent receipt and correct queued/no_staff semantics.
- Owner-scoped employee creation with quota, employee shifts and timed end, configurable department/all routing, owner shift force-end, staff/owner call histories.
- Persisted owner alert and pending delivery outbox. **No actual push or realtime dispatcher is running yet.**
- Frontend/Expo adapters, staging smoke test and production deployment NOT VERIFIED.
