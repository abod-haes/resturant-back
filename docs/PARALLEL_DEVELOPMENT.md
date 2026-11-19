# Parallel development protocol — Backend + Admin/Restaurant Dashboard
**Status: DEVELOPMENT START APPROVED BY EXISTING PRODUCT SCOPE; NOT PRODUCTION READY.**
This document guides two autonomous coding agents working concurrently. Each agent owns only its repository. Never infer endpoints or permissions from demo UI. Runtime mock datasets remain independent between apps; shapes and error semantics are coordinated.

## Canonical source of truth (in precedence order)
1. `resturant-back/docs/PRD.md` for approved business requirements, no ESP32 in V1
2. `resturant-back/openapi/restaurant.v1.yaml` for **only paths actually defined**; it is an incomplete draft
3. `resturant-back/docs/OPENAPI_IMPLEMENTATION.md` and `docs/API_CONTRACTS.md` for remaining planned endpoints (draft, not implemented)
4. `resturant-back/docs/RBAC_MATRIX.md`, `docs/ERD.md`, `docs/USER_FLOWS.md`, `docs/TEST_STRATEGY.md`
5. This repository's `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/ENGINEERING_PLAYBOOK.md`, `docs/FEATURE_COMPLETION_CHECKLIST.md`.

Do not assume `docs/API_CONTRACTS.md` is executable OpenAPI or that current demo schemas are production contract. In particular, existing dashboard `packages/api/src/live.ts` is a placeholder: product paths and create-restaurant payload do not yet follow backend draft, and list endpoints need pagination envelope. Replace only as contracts for each vertical slice are finalized.

## Ownership
Backend agent: Nest modules, migrations, auth/RBAC, API DTO/schema, OpenAPI, server data/transactions, tests, event semantics, documentation. Backend may create backend-owned fixtures but must not change frontend files.
Dashboard agent: workspace `apps/admin`, `apps/restaurant`, `packages/ui`, `packages/api`, `packages/config`; design tokens and custom reusable primitives, features, mock/live adapters, accessibility/RTL, tests. Do not implement backend authorization client-side as security. Dashboard may not modify backend files.
Both agents: write small isolated changes, no app-to-app imports, no generic mega-services/components, no feature-private cross imports, explicit loading/error/empty states, no unverified passing claim.

## Vertical-slice sequence
| Slice | Backend agent deliverable | Dashboard agent deliverable |
|---|---|---|
| 0 Foundations | Strict TS build, env validation, DB migrations, OpenAPI generation, health/readiness, CI tests | Workspace install/build, routing/layouts/providers, custom reusable UI primitives, typed mock/live interface, CI tests |
| 1 Auth | Password/session policy, role + tenant guards, /auth/me, role/branch scopes | Login/session shell, role-aware navigation; mock auth; no real access assumptions |
| 2 Restaurant onboarding | Admin creates restaurant/owner/branch, paginated list, schema + RBAC tests | Admin restaurant list/create/details using validated mock client |
| 3 Branches/menu | Scoped branch/category/product CRUD, media, pagination, branch-independent copy | Owner branch selector, category/product editor, validation and pagination |
| 4 Tables/QR | Floor/area/table, QR issue/revoke/rotate, PDF; permission tests | Owner table manager, bulk generation, QR actions/print |
| 5 Employees/calls | Employee/shifts, visit session, atomic cooldown/idempotency, owner alerts, event outbox | Employee management, call settings/history/alerts, correct delivery-state copy |
| 6 Subscription/analytics | Limits, grace/expiry, renewals, audit, analytics; regression/security suite | Plan/renewal/contact/analytics UI; access/expired states |
No slice may be marked integrated until backend and dashboard contract tests against a real staging API pass.

## Exact handshake for EACH endpoint
1. Backend publishes request/response DTO, validation, auth role/tenant/branch policy, status/error codes, cursor pagination and sample payloads in versioned OpenAPI. Backend records changelog.
2. Dashboard consumes only that contract, implements mock adapter and live adapter **with identical interface**, parses boundary response using shared runtime schemas, and adds UI/query tests.
3. Backend tests authorized + unauthorized + cross-tenant, empty/large + validation, and migration behavior. Dashboard tests success/loading/empty/offline/401/403/429/500 and RTL.
4. Integration uses a dedicated staging URL, sample nonsecret credentials, explicit `mock|live` flag, and a smoke checklist. Neither agent changes the other repository or says integrated before live verification.
5. Breaking changes require cross-repo announcement, version/changelog + migration plan; never silently rename fields.

## UI customization + reuse
Use **one** accessible design-system implementation for common Button, Select, Input, Dialog, DataTable, Pagination, Feedback, Card, Typography; use theme tokens, variants, compound primitives, i18n and RTL. Reuse in both apps through `@restaurant/ui`, not copy-paste. Feature-specific widgets stay in feature; promote only after real reuse. Avoid untyped dynamic form components. All lists paginated, default 20, max 100.
App entrypoints compose providers/router only; feature-specific domain/data logic stays local. Do not keep implementing legacy root `src/` of dashboard; migrate approved logic explicitly.

## Conflict-prevention rules
- Backend API paths, enums, DTO names, error envelope, money and date units are **contract-owned**. Dashboard may propose a change but cannot silently invent it.
- OpenAPI draft is incomplete; unresolved semantics (session expiresAt format, refresh transport, grace logic, owner support, exact owner product paths) must be settled per slice **before** integration, not guessed.
- Current dashboard starter `apps/*/src/App.tsx` and mock `packages/api/src/mock.ts` are demo scaffolds, not finished features.
- Runtime fixtures are independent; fixtures may be copied by schema version for testing, never require a shared mock server.
- Only add shared abstractions when two concrete callers need them; avoid premature framework building.
- All feature completion reports use `docs/FEATURE_COMPLETION_CHECKLIST.md` PASS/FAIL/NOT RUN, and `npm run check:architecture`, typecheck, tests, build.
- If a gate is unavailable, mark NOT RUN and explain blockers; missing tests must not be hidden by a pass-with-no-tests flag.

## Stop conditions / integration blockers
Incomplete OpenAPI, backend DB not configured, no real auth, dashboard placeholders, lack of confirmed build/test results. None blocks starting separate feature implementation; all block claiming a production-ready or fully integrated system.

## Pilot
Integrate one restaurant and one branch end-to-end first, confirm tenant isolation and call delivery states, then scale to 50 tables and multiple tenants.
