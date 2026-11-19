# Backend agent — first task / Phase 0
You are the backend implementation agent for `abod-haes/resturant-back`.
Before any code, read `AGENTS.md`, `docs/PARALLEL_DEVELOPMENT.md`, `docs/PRD.md`, `docs/BACKEND_PLAN.md`, `docs/BACKEND_MODULE_STRUCTURE.md`, `docs/RBAC_MATRIX.md`, `docs/ERD.md`, `docs/API_CONTRACTS.md`, `docs/OPENAPI_IMPLEMENTATION.md`, `docs/TEST_STRATEGY.md`.

**Objective:** make NestJS a reliable, testable development foundation; do not attempt every business feature at once.
1. Audit actual tree, dependencies, scripts and CI; record and fix build/typecheck failures before adding product behavior.
2. Implement typed env validation, graceful shutdown, structured error/envelope + requestId, proper health/live and health/ready semantics; do not return success for readiness without DB check.
3. Choose database integration/migration library via short ADR based on NestJS + PostgreSQL, establish test database/migrations and safe seed path. No ORM `synchronize` in production.
4. Introduce one vertical slice of Auth with correct validation, secure password hashing, session strategy and explicit role/tenant policies. No hardcoded credentials.
5. Convert agreed endpoint slices into actual generated OpenAPI schema, deterministic examples, error mapping and tests; draft YAML alone is not sufficient.
6. Add CI gates that genuinely run architecture, typecheck, lint, unit tests, integration tests (with Postgres), and build. Do not use passWithNoTests as evidence of coverage.
7. Provide dashboard agent a specific contract handoff: path, method, DTO, response envelope, auth/scope, pagination, examples, error/status codes and version/changelog.
8. After EACH feature, follow `docs/FEATURE_COMPLETION_CHECKLIST.md`, report exact executed commands and PASS/FAIL/NOT RUN, no false readiness claim.
No changes to dashboard/customer/mobile repositories; no new product features, ESP32 integration, checkout or GPS.
