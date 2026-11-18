# NestJS modular monolith — implementation blueprint
```
src/
  main.ts
  app.module.ts
  common/{config,errors,logging,interceptors,guards,decorators,validation}
  modules/
    auth/{presentation,application,domain,infrastructure}
    platform-admin/{presentation,application,domain,infrastructure}
    restaurants/{presentation,application,domain,infrastructure}
    subscriptions/{presentation,application,domain,infrastructure}
    branches/{presentation,application,domain,infrastructure}
    menus/{presentation,application,domain,infrastructure}
    tables-qr/{presentation,application,domain,infrastructure}
    employees-shifts/{presentation,application,domain,infrastructure}
    service-calls/{presentation,application,domain,infrastructure}
    notifications/{presentation,application,domain,infrastructure}
    analytics/{presentation,application,domain,infrastructure}
  database/{migrations,seeds}
test/{unit,integration,e2e,contracts}
```
Use PostgreSQL transactions for idempotency + cooldown; unique keys for idempotency, safe concurrency locks; transactional outbox for event delivery. Every repository query scopes restaurant/branch. Database FK, unique indexes and soft delete indexes; migration forward/rollback policy. No distributed microservices or event sourcing in V1. Queues/realtime only when justified. Each feature exports application interfaces, never imports another feature's ORM entities directly. Dependencies injected via ports.
