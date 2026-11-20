# Executable Swagger / OpenAPI inventory (v0.12)

The **authoritative executable Swagger** is generated directly from NestJS controllers and validated DTO decorators at runtime. It is independent from the hand-maintained `openapi/restaurant.v1.yaml` reference, which remains an explicit draft/specification inventory. The build serves:

- **UI:** `GET /api/docs`
- **JSON for client type generation:** `GET /api/docs-json`
- **Business endpoints:** `/api/v1/*` (auth, platform accounts, restaurants, plans/subscriptions, branches/menu, floors/areas/tables/QR/PDF, visits/calls, employee/shifts, push devices, owner/employee SSE, analytics/audit, media/galleries, health).

The runtime specification has one shared `ApiErrorEnvelope` response schema matching `ApiExceptionFilter`, with `{error:{code,message,details?},requestId}` for non-2xx outcomes. Every operation includes a standard non-2xx `default` response alongside its feature-specific responses. Protected endpoints expose Bearer auth via Nest decorators. Browser refresh uses HttpOnly cookie + Origin verification; mobile uses `client=mobile` and a rotating refresh token. Never treat tokens in fixtures as production credentials.

`test/integration/swagger-completeness.spec.ts` is **mandatory** in `npm run test:integration`: it loads the actual Nest application, requests Swagger UI + generated JSON, and requires the generated endpoint/method inventory to exactly match all operations in the versioned YAML, including recent v1.9–v1.12 work. New routes without documentation or stale YAML cannot pass CI. Schema/type errors and contract fixtures continue to be checked by `npm run check:contract`.

This is contract/documentation readiness, **not** evidence of successful staging connectivity, end-user delivery, client binding or production deployment. Export `/api/docs-json` from the *same deployed backend revision* for frontend type/adapter generation; never use the static reference as a substitute for the generated DTO schemas.
