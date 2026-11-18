# Backend implementation plan — NestJS + PostgreSQL
## Architecture
Modular monolith, REST/OpenAPI, PostgreSQL, optional Redis+BullMQ for reliable background work, transactional outbox for calls/notifications, object storage for images, WebSocket for foreground realtime, Expo Push for background. Docker + Dokploy VPS. Explicit tenant scoping in every query.

## Milestones
1. Bootstrap: strict TS, config validation, logging, migrations, OpenAPI, tests, CI, health probes.
2. Identity: primary admin/admin/owner/employee RBAC, rotating sessions, forced password reset, audit.
3. Tenants: restaurants, independent branches, plan limits, manual subscription activation/renewal, grace expiration.
4. Menu: categories, products, images, ordering, availability, templates, independent copy.
5. Tables: floors/areas, bulk table creation, stable QR tokens, rotate/revoke, print PDF.
6. Calls: session token, 4h idle expiry, per-table/type atomic 10s cooldown, idempotency, server validations, owner alerts when no staff.
7. Employee: shift start/end, configurable auto-end, owner forced end, device token registration, branch/routing isolation.
8. Delivery: outbox queue, push, WebSocket, retries and monitoring; call saved before fanout.
9. Analytics/audit, backups and restore drills, load tests, pilot.

## Acceptance
- Cross-tenant/branch access returns 403/404; all mutating operations audited.
- Concurrent duplicate calls produce exactly one accepted event per idempotency key and cooldown window.
- Push failure never rolls back accepted call; owner fallback alert if no eligible active staff.
- Expired subscription blocks public operational endpoints and dashboard operations, but owner can view renewal contact.
- QR rotation revokes old sessions; disabled branch blocks all calls.
- Tests include no staff, offline, stale push tokens, empty/large menus, plan limits and permission failures.

## Suggested source structure
`src/modules/{auth,admin,restaurants,branches,menu,tables,employees,shifts,calls,notifications,subscriptions,analytics,audit,media}/`
Each module: controller, service, repository, DTO/schema, policy and tests. Shared infrastructure in `src/common/`; avoid circular dependencies and generic mega-services.
