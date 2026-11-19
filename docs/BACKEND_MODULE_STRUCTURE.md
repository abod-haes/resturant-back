# NestJS Modular Monolith — implementation conventions

The structure below is a **target ownership map**, not an instruction to create empty directories upfront. Prefer small cohesive modules over a blanket four-layer template.

```text
src/
  main.ts
  bootstrap.ts                    # HTTP/validation/Swagger setup
  app.module.ts                   # composition only
  common/
    config/                       # typed runtime configuration
    http/                         # request IDs, error envelope
    auth/                         # cross-cutting authentication guards/decorators (later)
  database/
    database.module.ts
    database.service.ts           # PostgreSQL connection/readiness foundation
    migrations/                   # planned, not implemented yet
    seeds/                        # planned, not implemented yet
  integrations/                   # storage/push/realtime adapters when implemented
  modules/
    health/
    auth/
    platform-admin/
    restaurants/
    subscriptions/
    branches/
    menus/
    tables-qr/
    employees-shifts/
    service-calls/
    notifications/
    analytics/
    audit/
test/
  unit/
  integration/
  e2e/
  contracts/
```

## Module boundaries
1. Controllers parse/validate and invoke application use cases; never access the database directly.
2. Domain rules are framework-neutral. Use application ports only for real external dependencies, not every one-line CRUD service.
3. Infrastructure implements persistence, provider and outbound event adapters. Cross-module collaboration goes through exported public providers/contracts, not deep imports.
4. `common/` is for shared technical primitives; domain-specific policies stay in the owning feature. Do not create mega-services.
5. Every tenant-owned repository query verifies restaurant and branch scope from authenticated principal. No caller-supplied tenant authorization.
6. Database transactions protect invariants, with unique constraints for idempotency, atomic per-table/type cooldown and outbox events for service calls.
7. Feature completion requires architectural checks, strict TS, lint, tests, build, access control and failure-state review; see `FEATURE_COMPLETION_CHECKLIST.md`.

## Foundation limitations
The current database service only supplies a connection-health probe. It is **not** a migration implementation, authorization boundary, or data access layer for production features. Introduce concrete schema/migrations/transactions with the first persistent business slice; document choice in a dedicated ADR first. Do not enable ORM auto-synchronize.
