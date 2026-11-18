# Architecture principles — v1.2
**Approved product:** multi-tenant restaurant QR menu + staff calls. No GPS, checkout or hardware in V1. Backend is authoritative. Each frontend uses its own mock state; runtime synchronization is NOT required.

## Boundaries
- Domain: entities, value objects, rules, invariants, policy; framework-independent.
- Application: use cases and orchestration, interfaces/ports; no UI or persistence dependency.
- Infrastructure: HTTP, database, storage, push, queues, mock adapters; implements ports.
- Presentation: React routes/components or Nest controllers; calls application layer.
- Dependency direction: presentation -> application -> domain; infrastructure -> application ports. Do not create an abstraction unless it protects a real boundary.
- Share stable cross-cutting UI/types only; feature-specific behavior remains local.
- API DTO != DB model != UI view model. Explicit mapping, runtime validation and stable error envelope.
- Auth: platform roles and tenant scopes verified server-side on every protected operation; defense in depth.
- Data: soft-delete/archive preserves history; tenant/branch scoping and transactional changes.
- Async calls: idempotency, per-table/type cooldown, 4h idle sessions, outbox/retry, no-staff owner alert.
- Config: typed env validation, no hardcoded secrets. Observability: structured logs, trace/request IDs, no PII.
- Prefer a modular monolith in NestJS, not microservices at V1.
## Review gates
No circular dependencies, no unbounded list APIs, no untested critical workflows, no direct network calls from views, no undocumented breaking contracts.
