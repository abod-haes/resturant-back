# Backend fixtures & client mocks — contract authority
Backend is **source of truth for OpenAPI, DTOs, authorization and error semantics**; backend does not need a shared running mock server.
- `mocks/fixtures.json` and `mocks/scenarios.json` are documentation/test examples, not a production data store.
- Each consumer (dashboard, customer, employee) owns independent runtime mock state; mocks need not exchange data.
- Backend publishes versioned operationId, request schema, response envelope, standard error codes, authentication/scope, pagination (default 20 max 100), and example payload per endpoint **before** clients implement live integration.
- All backend modules must test real validation, RBAC cross-tenant/branch restrictions, transactions, idempotency and failures against test PostgreSQL. Never replace a backend integration test with a UI mock.
- No secrets or real user data in fixtures; deterministic scenarios for no staff, cooldown, QR revoked, subscription expired, offline and large data.
- Any breaking change: backend updates OpenAPI + changelog, backend tests; notifies all affected client agents, and they update mock/live parity and contract tests. Live staging verification precedes an integrated/production-ready claim.
See `docs/PARALLEL_DEVELOPMENT.md`, `docs/OPENAPI_IMPLEMENTATION.md`, `docs/FEATURE_COMPLETION_CHECKLIST.md`.
