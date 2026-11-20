# Test strategy and acceptance matrix
## Gates
Every PR: formatting/lint, strict typecheck, unit tests, API contract tests, build. Critical flows: integration + E2E. Never mark a gate passing without running it.

## Critical scenarios
1. Primary admin creates platform admin; non-primary denied.
2. Admin creates restaurant + owner + initial branch; tenant isolation.
3. Plan limits enforce max branches/tables/employees/features and monthly/yearly manual activation.
4. Subscription grace and expiration: public operational calls stop, owner renewal contacts remain.
5. Owner branch copy creates independent menu/template; later edits do not leak.
6. Category/product availability, multiple images, old price, archived history.
7. Floor/area/table QR stable on rename; rotation invalidates old token.
8. General menu never exposes call credentials; QR welcome includes correct table.
9. First call requires confirmation, subsequent calls direct within visit; idle 4h expiry.
10. Concurrent calls enforce atomic 10s cooldown per table/type and idempotency.
11. Department vs all-branch routing, employee shift start/end/auto-end, no-staff owner alert.
12. Foreground event, background push, permission denied, reconnect and history fallback.
13. Arabic RTL, keyboard accessibility, mobile layouts, empty/loading/error/offline states.
14. Owner/employee cannot access other tenant or branch; admin roles isolated.
15. Cursor pagination, sort/filter stable under large datasets; 401/403/429/500 safe handling.
16. Mock/live adapter schema parity, fixture version consistency, OpenAPI diff review.
17. Backup/restore drill, migration rollback and health/readiness checks.
## Test pyramid
Domain pure unit tests; repository/controller integration tests against test PostgreSQL; contract tests generated from OpenAPI; Playwright E2E for web; Expo device smoke tests; load tests for concurrent calls.
## Definition of done
Business acceptance, no regression, observability, tests executed and documented, docs updated, no security exceptions.

## Automated multi-role restaurant journey E2E
Run `npm run test:e2e` against a migrated, isolated PostgreSQL database whose name ends in `_test`. This is a separate mandatory GitHub Actions gate after integration tests. The scenario exercises HTTP routes for primary bootstrap fixture, restaurant/owner onboarding, plan activation, forced password changes, branch currency and public menu, floors/areas/two table QRs, no-staff call/owner alert/idempotency/cooldown, employee shift/device registration, queued recipient outbox, a fake Expo gateway ticket, recipient realtime events, cross-tenant/role isolation, QR rotation and subscription expiry.

**Boundary:** the test checks persistence and simulated provider acceptance; it does not assert an actual phone received a push, audio played, SSE crossed a network proxy, a real CDN/storage was configured, or the dashboards/mobile/customer app were integrated. Keep the mock provider limited to the external Expo transport and never route test credentials to external services. Reuse `test/integration` for specialized feature cases; this suite enforces the whole critical customer-to-staff workflow.
