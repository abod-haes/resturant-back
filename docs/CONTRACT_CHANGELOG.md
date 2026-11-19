# Contract changelog

## v1.9.0 — 2026-11-19 (Expo push backend + durable SSE)
New encrypted employee device registry (GET/POST/DELETE /employee/devices), five active devices maximum, server-side account binding and redacted response DTOs. Opt-in standalone push worker with per-device durable state, bounded retry/lease, Expo HTTP tickets and separate receipt reconciliation, invalid token deactivation. Restaurant-scoped transactional realtime event sequence, authenticated owner and employee SSE with cursor replay, per-tick session revalidation and multi-replica PostgreSQL polling. Events: call.created, owner.alert.created, shift.updated. **Expo tickets/receipts are not confirmation that a human received an alert**. OS sound channel registration and physical phone tests require the Expo app; no external owner channel, Redis, mobile frontend or dashboard staging integration. See ADR-009 and PUSH_REALTIME_HANDOFF.md.


## v1.8.0 — 2026-11-19 (Visits, employees, shifts, calls)
4-hour idle QR-linked anonymous visit tokens hashed at rest; first-call confirmation, transactional per-table/type 10-second cooldown, session+UUID idempotency, and QR rotation/disable revocation. Owner employee accounts with scoped branch/department and maxEmployees quota, password reset and archiving; employee shifts with configurable 60..1440 minute automatic cutoff. Global call settings and nullable branch overrides; shift/department routing to durable per-recipient pending outbox. No-staff calls persist owner dashboard alerts. Owner/employee paginated call histories. Public QR callsAvailable reflects settings and entitlement. **Push, realtime, external delivery, employee device registration and analytics are not implemented**. See docs/VISITS_CALLS_HANDOFF.md and ADR-008.


## v1.7.0 — 2026-11-19 (Tables & QR)
Tenant/branch-constrained floor, area and table management with soft archives, paginated owner CRUD, atomic bulk table creation (max 50/request), and transactionally enforced maxTables including disabled tables but excluding archived. Stable cryptographically random per-table QR credentials stored only as SHA-256 hashes + AES-256-GCM envelopes. QR issue on table creation; owner GET/rotate/disable; explicit QR re-enable via PATCH table. Public GET /public/t/:token returns read-only table/menu context and no session/call capability. Owner A4 printable QR PDF (up to 100 tables), with Arabic print-label fallback limitation documented. New deployment env QR_TOKEN_ENCRYPTION_KEY and CUSTOMER_APP_ORIGIN required for QR issuance/print. No client app integration, visit sessions, calls or production deployment claimed. See docs/TABLES_QR_DASHBOARD_HANDOFF.md.


## v1.6.0 — 2026-11-19 (Branch & Menu vertical slice)
Owner branches CRUD with transactional plan quota, tenant isolation and configured per-branch currency. Nested category/product CRUD, search/cursor pagination, old price/sold-out/visibility/tags, soft archive and relational same-branch constraints. Images are URL metadata restricted to configured HTTPS CDN origins; upload/transformation deferred. Menu copy is additive only into empty destination branch with independent IDs; floor/table templates deferred. Public paginated catalog excludes hidden or archived content and never exposes QR/call credentials. Subscription feature and effective expiry apply on every operation. See docs/BRANCH_MENU_DASHBOARD_HANDOFF.md. No dashboard staging adapter handshake claimed.


## v1.5.0 — 2026-11-19 (Manual Plans & Subscriptions)
Admin plan create/list/get/update; explicit feature flags and limit data, snapshot on activation/renewal. Pending restaurant subscription create, manual activate/renew (no payment), effective scheduled/active/grace/expired evaluation from UTC calendar dates, audited immutable term history. Configurable renewal contacts and owner read endpoint usable while expired. Contract handoff: docs/SUBSCRIPTION_DASHBOARD_HANDOFF.md. Branch/table/employee resource limit enforcement will be wired transactionally in their later feature slices; not claimed integrated now. Swagger generated from implemented controllers; OpenAPI YAML remains partly draft.


## v1.4.0 — 2026-11-19 (Restaurant onboarding vertical slice)
Implemented POST/GET paginated admin restaurants, GET/PATCH admin restaurant details. Admin creates restaurant, owner and initial branch in an atomic transaction; errors and audit follow v1 standard. Created owner has mustChangePassword=true and no subscription is automatically activated. Stable opaque cursor, default 20 max 100, and literal substring search. Fixture example: `mocks/contracts/restaurant-onboarding-v1.4.json`. Dashboard handoff: `docs/RESTAURANT_DASHBOARD_HANDOFF.md`. Other CRUD endpoints remain drafts; no staging integration claimed.

## v1.3.0 — 2026-11-19 (Auth vertical slice)
Implemented login/refresh/logout/me/change-password; runtime DTO validation, per-user throttling, short-lived JWT, rotating refresh (cookie web / body mobile), forced initial password change and deny-by-default role/branch scopes. `client` is optional default `web` and user includes `mustChangePassword`. Password change revokes all sessions and requires new login. Existing public QR and other draft endpoints remain **unimplemented**. Generated Swagger in Nest is the executable truth for the implemented slice; YAML contains drafts for unimplemented endpoints.
Consumer handoff: `docs/AUTH_DASHBOARD_HANDOFF.md`. Do not claim integrated until staging smoke tests pass.

## v1.2.0 — 2026-11-18
Added implementation-level request/response conventions, cursor pagination default 20/max 100, DTO inventory, explicit 429 retryAfterSeconds, role matrix and modular architecture. Draft until generated OpenAPI and contract tests validate implementation. Clients must use consistent DTOs.
## v1.1.0
Normalized fixtures and stateful mock engine across consumers, without runtime synchronization.
## v1.0.0-draft
Initial endpoint inventory.
