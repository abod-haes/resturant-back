# ADR-003 — PostgreSQL persistence, migrations and tenant integrity

Date: 2026-11-19. Status: Accepted for core relational foundation.

## Decision
- PostgreSQL 17 remains the source of truth.
- Use **Kysely** as a small type-safe SQL query builder over the existing `pg` connection pool. It is not an auto-schema ORM and must never silently modify production schema.
- Version all schema changes as **reviewable SQL migration files** in `database/migrations`; apply using `scripts/migrate.mjs` in a single transaction with a transaction-scoped advisory lock.
- Record SHA256 checksums in `schema_migrations`; fail on missing, changed or pending migration in check mode.
- Never use ORM auto-synchronize, unreviewed destructive DDL, or production seed credentials. Migration changes require an ADR/update plan and test coverage.

## Initial schema
- `restaurants`, `branches`, `users` with role/tenant and single-owner constraints; employees must reference a branch of their own restaurant via composite FK.
- `plans`, `subscriptions` store manual subscription state without prematurely defining grace-period business rules or payments.
- `audit_logs` for future immutable business operation records; authorization and audit writing must be implemented in feature use cases.
- Indexed tenant relations and timestamps; UUID primary keys. Department values limited to waiter/hookah.

## Application ownership and limitations
- Database schema constraints are **defense in depth**, not a substitute for RBAC, per-query tenant scoping, auditing or transactional application logic.
- A user role is currently modeled as one scoped principal: one owner per restaurant; an employee belongs to one branch/department. Cross-restaurant sessions are forbidden in the auth layer.
- Kysely table types are manually synchronized with SQL and are expected to gain typed repositories and query integration tests per feature.
- No authentication, manager impersonation, subscription enforcement, QR tables, call outbox or data migration of existing production records is implemented here.

## Operational procedure
1. Configure `DATABASE_URL` for the specific environment (local, staging, production).
2. Back up the production database and confirm maintenance/rollback plan before executing new migrations.
3. Run `npm run db:migrate` before deploying the API. Concurrent migration runners are serialized.
4. Run `npm run db:migrate:check` as a release gate.
5. After a production migration, use a new forward-only correction migration; never edit already-applied SQL or delete history.

## Rollback
Initial schema is additive; app rollback is safe as long as code remains compatible. Destructive rollback requires reviewed SQL and backup restore, not automatic DOWN scripts.

## Schema choices pending product decisions
Exact grace-period duration, plan feature key registry, cross-branch user reassignment, and any expanded admin support policy are intentionally left to later acceptance.
