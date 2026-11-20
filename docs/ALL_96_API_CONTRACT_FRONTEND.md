# Restaurant Platform — Complete API consumer handoff

> **Compiled from `openapi/restaurant.v1.yaml` on `main` at 2026-11-20.** This catalogue indexes **96 HTTP operations**, grouped by access and module, and 32 named reference schemas. Each path below is a real implemented controller route, with CI endpoint-inventory parity to the NestJS-generated Swagger (backend PR #18). No frontend implementation or live staging connectivity is implied. The versioned YAML is a hand-maintained reference: it is **not** a substitute for the runtime-generated OpenAPI JSON when strict DTO generation is required.

## Source of truth and base URLs

- **Runtime authoritative Swagger UI:** `https://<deployed-backend-domain>/api/docs`
- **Runtime authoritative OpenAPI JSON:** `https://<deployed-backend-domain>/api/docs-json`
- **Versioned OpenAPI YAML (all 96 paths):** [restaurant.v1.yaml](../openapi/restaurant.v1.yaml)
- **Business rules and detailed error cases:** [docs/API_CONTRACTS.md](API_CONTRACTS.md)
- **Backend runtime API prefix:** `/api/v1`. Do **not** append `/api/v1` again if the frontend's base URL already includes it.
- Controller DTOs with Swagger decorators + class-validator specify the actual request and response shape. The versioned YAML may contain descriptions without explicit response schemas: for **all** generated TS shapes consume `/api/docs-json` from the *same deployed revision*.

## Conventions

| Concern | Contract |
|---|---|
| Success single | `{ "data": T }` |
| Success collection | `{ "data": T[], "meta": { "nextCursor": string \| null, "hasMore": boolean } }` |
| Error | `{ "error": { "code": string, "message": string, "details"?: unknown }, "requestId": string }` |
| Authentication | `Authorization: Bearer <15-minute access JWT>` for protected endpoints; browser refresh/logout use trusted Origin + HttpOnly cookie; mobile uses rotating `refreshToken` in secure storage |
| Scope | Server enforces role, restaurant, branch, subscription, active/archived and feature permissions; never trust client-supplied tenant or mock IDs |
| Amounts | Integers in currency minor units, e.g. `priceMinor`; branch `currency` ISO 4217; read currency exponent from ISO code, do not assume /100 |
| IDs/times | UUID v4 resource IDs; date-times ISO 8601 UTC; opaque keyset pagination cursor |
| Pagination | Default 20, max 100 where paginated; explicitly pass smaller limit (10–20) for dashboard lists |
| Call types | `waiter \| hookah`; delivery state `queued \| no_staff` is not handset delivery |
| Live events | `text/event-stream` owner/employee SSE with bearer header + `Last-Event-ID` resume; GET history is source of truth |
| File upload | `multipart/form-data` only for media images and PDF documents; authorized document download returns expiring URL |

**Request body column:** When a named schema is shown, read its definition from OpenAPI `components.schemas`. A comma-separated field list means the first declared inline `required` group extracted from the YAML; for optional nested fields and exact validation use the full YAML or generated JSON. “Inline JSON DTO” means the object is defined inline under the endpoint, not that its fields are untyped.

**Roles:** `PRIMARY_ADMIN` only can manage platform admins and read redacted audit logs. Other `/admin/*` endpoints allow primary/platform admin. `/owner/*` owner-scoped and `/employee/*` staff-scoped. `/public/*` requires no login but the QR and visit endpoints require valid opaque QR/session credentials. `/auth/refresh` and `/auth/logout` rely on refresh credentials (web cookie or mobile body) even though an access bearer JWT is not required.

## Examples

### Platform login

```http
POST /api/v1/auth/login
Content-Type: application/json

{"username":"admin.example","password":"<secret>","client":"web"}
```

The browser receives the refresh credential as an HttpOnly cookie, with a short-lived `data.accessToken` for authenticated operations. For Expo mobile specify `"client":"mobile"` and persist the returned rotating `refreshToken` only in secure OS storage.

### Owner product create

```http
POST /api/v1/owner/branches/{branchId}/products
Authorization: Bearer <accessToken>
Content-Type: application/json

{"categoryId":"<uuid>","name":"Arabic Coffee","priceMinor":1250,"isVisible":true,"isSoldOut":false}
```

Branch currency must be configured first. Do not include branch currency in this body.

### Public QR → visit → first call

```http
GET /api/v1/public/t/{qrToken}
GET /api/v1/public/menu/{branchSlug}?limit=20
POST /api/v1/public/t/{qrToken}/sessions
POST /api/v1/public/calls
Content-Type: application/json

{"sessionToken":"<opaque-session>","type":"waiter","idempotencyKey":"<uuid>","confirmFirstCall":true}
```

Require explicit first-call user confirmation; second/subsequent calls use `confirmFirstCall:false` as permitted. Backend enforces 10-second table/type cooldown, idempotency and ~4h idle visit expiry regardless of frontend timers. Never place visit tokens into URLs or analytics.

### Generate frontend TypeScript types

Use the **generated backend JSON from your deployed revision**, not the static YAML draft, for strict type generation:

```bash
curl -fsSL 'https://<deployed-backend-domain>/api/docs-json' -o restaurant.openapi.json
npx openapi-typescript restaurant.openapi.json -o src/shared/api/generated/restaurant.d.ts
```

Use one typed HTTP adapter; keep DTO and presentation models separate; runtime-validate untrusted responses; route all feature networking via React Query/domain services.

## Authentication (5)

### Authentication

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `POST` | `/auth/login` | username, password | — | 200 | 400, 401, 429 | Public / credential-specific |
| `POST` | `/auth/refresh` | Inline JSON DTO | — | 200 | 401 | Public / credential-specific |
| `POST` | `/auth/logout` | — | — | 200 | 401 | Public / credential-specific |
| `GET` | `/auth/me` | — | — | 200 | 401 | Bearer (any signed-in role) |
| `POST` | `/auth/change-password` | — | — | 200 | 400, 401, 403 | Bearer (any signed-in role) |

## Platform administration (20)

### Platform audit

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/admin/audit-logs` | — | `restaurantId`, `actorId`, `action`, `cursor`, `limit` | 200 | 400, 401, 403 | PRIMARY_ADMIN |

### Platform restaurants

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `POST` | `/admin/restaurants` | name | — | 201 | 400, 401, 403, 409 | PRIMARY_ADMIN / PLATFORM_ADMIN |
| `GET` | `/admin/restaurants` | — | `limit`, `cursor`, `search` | 200 | 400, 401, 403 | PRIMARY_ADMIN / PLATFORM_ADMIN |
| `GET` | `/admin/restaurants/{id}` | — | — | 200 | 400, 401, 403, 404 | PRIMARY_ADMIN / PLATFORM_ADMIN |
| `PATCH` | `/admin/restaurants/{id}` | Inline JSON DTO | — | 200 | 400, 401, 403, 404 | PRIMARY_ADMIN / PLATFORM_ADMIN |

### Plans

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/admin/plans` | — | `limit`, `cursor` | 200 | 401, 403 | PRIMARY_ADMIN / PLATFORM_ADMIN |
| `POST` | `/admin/plans` | menu, waiter_calls, hookah_calls, analytics | — | 201 | 400, 409 | PRIMARY_ADMIN / PLATFORM_ADMIN |
| `GET` | `/admin/plans/{id}` | — | — | 200 | 404 | PRIMARY_ADMIN / PLATFORM_ADMIN |
| `PATCH` | `/admin/plans/{id}` | — | — | 200 | 400, 409 | PRIMARY_ADMIN / PLATFORM_ADMIN |

### Subscriptions

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `POST` | `/admin/restaurants/{restaurantId}/subscriptions` | planId, period | — | 201 | 400, 404, 409 | PRIMARY_ADMIN / PLATFORM_ADMIN |
| `GET` | `/admin/restaurants/{restaurantId}/subscription` | — | — | 200 | default | PRIMARY_ADMIN / PLATFORM_ADMIN |
| `POST` | `/admin/subscriptions/{id}/activate` | graceDays | — | 200 | 400, 404, 409 | PRIMARY_ADMIN / PLATFORM_ADMIN |
| `POST` | `/admin/subscriptions/{id}/renew` | graceDays | — | 200 | 400, 404, 409 | PRIMARY_ADMIN / PLATFORM_ADMIN |

### Renewal contacts

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/admin/contact-methods` | — | — | 200 | default | PRIMARY_ADMIN / PLATFORM_ADMIN |
| `PATCH` | `/admin/contact-methods` | RenewalContact | — | 200 | 400 | PRIMARY_ADMIN / PLATFORM_ADMIN |

### Platform administrators

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/admin/platform-admins` | — | `limit`, `cursor`, `search` | 200 | 403 | PRIMARY_ADMIN |
| `POST` | `/admin/platform-admins` | name, username, initialPassword | — | 201 | 403, 409 | PRIMARY_ADMIN |
| `GET` | `/admin/platform-admins/{id}` | — | — | 200 | 403, 404 | PRIMARY_ADMIN |
| `PATCH` | `/admin/platform-admins/{id}` | Inline JSON DTO | — | 200 | 403, 404 | PRIMARY_ADMIN |
| `POST` | `/admin/platform-admins/{id}/reset-password` | initialPassword | — | 200 | 403, 404 | PRIMARY_ADMIN |

## Restaurant owner (55)

### Owner media library

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/owner/branches/{branchId}/media` | — | `kind`, `cursor`, `limit` | 200 | 403, 404 | RESTAURANT_OWNER |
| `POST` | `/owner/branches/{branchId}/media/images` | multipart: file | — | 201 | 400, 413, 415, 409, 503 | RESTAURANT_OWNER |
| `POST` | `/owner/branches/{branchId}/media/documents` | multipart: file | — | 201 | 413, 415, 503 | RESTAURANT_OWNER |
| `DELETE` | `/owner/branches/{branchId}/media/{id}` | — | — | 200 | 404, 409, 503 | RESTAURANT_OWNER |
| `GET` | `/owner/branches/{branchId}/media/{id}/download` | — | — | 200 | 404 | RESTAURANT_OWNER |

### Owner product galleries

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/owner/branches/{branchId}/products/{productId}/gallery` | — | — | 200 | 404 | RESTAURANT_OWNER |
| `PUT` | `/owner/branches/{branchId}/products/{productId}/gallery` | mediaId | — | 200 | 400, 404 | RESTAURANT_OWNER |

### Owner analytics

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/owner/call-analytics` | — | `from`, `to`, `branchId` | 200 | 400, 401, 403, 404 | RESTAURANT_OWNER |

### Realtime SSE

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/owner/events` | — | `after` | 200 | 401, 403 | RESTAURANT_OWNER |

### Owner employees

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/owner/employees` | — | — | 200 | default | RESTAURANT_OWNER |
| `POST` | `/owner/employees` | username, name, initialPassword, branchId, department | — | 201 | 403, 409 | RESTAURANT_OWNER |
| `PATCH` | `/owner/employees/{id}` | — | — | 200 | 409 | RESTAURANT_OWNER |
| `DELETE` | `/owner/employees/{id}` | — | — | 200 | default | RESTAURANT_OWNER |
| `POST` | `/owner/employees/{id}/reset-password` | — | — | 200 | default | RESTAURANT_OWNER |
| `POST` | `/owner/employees/{id}/end-shift` | — | — | 200 | 409 | RESTAURANT_OWNER |

### Owner calls

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/owner/calls` | — | — | 200 | default | RESTAURANT_OWNER |

### Owner alerts

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/owner/alerts` | — | — | 200 | default | RESTAURANT_OWNER |

### Owner call settings

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/owner/call-settings` | — | — | 200 | default | RESTAURANT_OWNER |
| `PATCH` | `/owner/call-settings` | — | — | 200 | default | RESTAURANT_OWNER |
| `GET` | `/owner/branches/{branchId}/call-settings` | — | — | 200 | default | RESTAURANT_OWNER |
| `PATCH` | `/owner/branches/{branchId}/call-settings` | — | — | 200 | default | RESTAURANT_OWNER |

### Owner subscription

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/owner/subscription` | — | — | 200 | 401, 403 | RESTAURANT_OWNER |

### Owner floors

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/owner/branches/{branchId}/floors` | — | `limit`, `cursor` | 200 | 401, 403, 404 | RESTAURANT_OWNER |
| `POST` | `/owner/branches/{branchId}/floors` | name | — | 201 | 400, 409 | RESTAURANT_OWNER |
| `PATCH` | `/owner/branches/{branchId}/floors/{id}` | Inline JSON DTO | — | 200 | 404, 409 | RESTAURANT_OWNER |
| `DELETE` | `/owner/branches/{branchId}/floors/{id}` | — | — | 200 | 404, 409 | RESTAURANT_OWNER |

### Owner areas

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/owner/branches/{branchId}/areas` | — | `limit`, `cursor` | 200 | 403, 404 | RESTAURANT_OWNER |
| `POST` | `/owner/branches/{branchId}/areas` | floorId, name | — | 201 | 404, 409 | RESTAURANT_OWNER |
| `PATCH` | `/owner/branches/{branchId}/areas/{id}` | Inline JSON DTO | — | 200 | 404, 409 | RESTAURANT_OWNER |
| `DELETE` | `/owner/branches/{branchId}/areas/{id}` | — | — | 200 | 404, 409 | RESTAURANT_OWNER |

### Owner tables

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/owner/branches/{branchId}/tables` | — | `limit`, `cursor` | 200 | 401, 403, 404 | RESTAURANT_OWNER |
| `POST` | `/owner/branches/{branchId}/tables` | areaId, label | — | 201 | 400, 403, 404, 409, 503 | RESTAURANT_OWNER |
| `POST` | `/owner/branches/{branchId}/tables/bulk` | areaId, labels | — | 201 | 400, 403, 409, 503 | RESTAURANT_OWNER |
| `GET` | `/owner/branches/{branchId}/tables/{id}` | — | — | 200 | 404 | RESTAURANT_OWNER |
| `PATCH` | `/owner/branches/{branchId}/tables/{id}` | Inline JSON DTO | — | 200 | 400, 404, 409 | RESTAURANT_OWNER |
| `DELETE` | `/owner/branches/{branchId}/tables/{id}` | — | — | 200 | 404 | RESTAURANT_OWNER |

### Owner QR

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/owner/tables/{tableId}/qr` | — | — | 200 | 404, 409, 503 | RESTAURANT_OWNER |
| `POST` | `/owner/tables/{tableId}/qr/rotate` | — | — | 200 | 404, 503 | RESTAURANT_OWNER |
| `POST` | `/owner/tables/{tableId}/qr/disable` | — | — | 200 | 404 | RESTAURANT_OWNER |

### Owner QR printing

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/owner/branches/{branchId}/qr/print` | — | `tableIds` | 200 | 400, 404, 409, 503 | RESTAURANT_OWNER |

### Owner branches

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/owner/branches` | — | — | 200 | 403 | RESTAURANT_OWNER |
| `POST` | `/owner/branches` | name | — | 201 | 400, 403 | RESTAURANT_OWNER |
| `GET` | `/owner/branches/{branchId}` | — | — | 200 | 404 | RESTAURANT_OWNER |
| `PATCH` | `/owner/branches/{branchId}` | Inline JSON DTO | — | 200 | 400, 404, 409 | RESTAURANT_OWNER |

### Owner categories

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/owner/branches/{branchId}/categories` | — | `limit`, `cursor`, `search` | 200 | 403, 404 | RESTAURANT_OWNER |
| `POST` | `/owner/branches/{branchId}/categories` | CreateCategory | — | 201 | 400, 409 | RESTAURANT_OWNER |
| `GET` | `/owner/branches/{branchId}/categories/{id}` | — | — | 200 | 404 | RESTAURANT_OWNER |
| `PATCH` | `/owner/branches/{branchId}/categories/{id}` | Inline JSON DTO | — | 200 | 400, 409 | RESTAURANT_OWNER |
| `DELETE` | `/owner/branches/{branchId}/categories/{id}` | — | — | 200 | 404 | RESTAURANT_OWNER |

### Owner products

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/owner/branches/{branchId}/products` | — | `limit`, `cursor`, `search` | 200 | 403 | RESTAURANT_OWNER |
| `POST` | `/owner/branches/{branchId}/products` | CreateProduct | — | 201 | 400, 404, 409 | RESTAURANT_OWNER |
| `GET` | `/owner/branches/{branchId}/products/{id}` | — | — | 200 | 404 | RESTAURANT_OWNER |
| `PATCH` | `/owner/branches/{branchId}/products/{id}` | url | — | 200 | 400, 404 | RESTAURANT_OWNER |
| `DELETE` | `/owner/branches/{branchId}/products/{id}` | — | — | 200 | 404 | RESTAURANT_OWNER |

### Owner menu copy

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `POST` | `/owner/branches/{branchId}/menu/copy-from` | sourceBranchId | — | 201 | 400, 403, 404, 409 | RESTAURANT_OWNER |

## Employee (8)

### Employee Push Devices

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/employee/devices` | — | — | 200 | 403 | EMPLOYEE |
| `POST` | `/employee/devices` | expoPushToken, platform | — | 201 | 400, 401, 403, 409, 503 | EMPLOYEE |
| `DELETE` | `/employee/devices/{id}` | — | — | 200 | 404 | EMPLOYEE |

### Realtime SSE

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/employee/events` | — | `after` | 200 | 401, 403 | EMPLOYEE |

### Employee shifts

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `POST` | `/employee/shifts/start` | — | — | 201 | 409 | EMPLOYEE |
| `GET` | `/employee/shifts/current` | — | — | 200 | default | EMPLOYEE |
| `POST` | `/employee/shifts/end` | — | — | 200 | 409 | EMPLOYEE |

### Employee calls

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/employee/calls` | — | — | 200 | default | EMPLOYEE |

## Public QR, visit and menu (6)

### Public table QR

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/public/t/{qrToken}` | — | — | 200 | 403, 404 | Public / credential-specific |

### Public visit

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `POST` | `/public/t/{qrToken}/sessions` | — | — | 201 | 403, 404, 429 | Public / credential-specific |
| `POST` | `/public/sessions/status` | sessionToken | — | 200 | 401, 404 | Public / credential-specific |

### Public calls

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `POST` | `/public/calls` | sessionToken, type, idempotencyKey | — | 201 | 401, 403, 404, 409, 429 | Public / credential-specific |

### Public menu

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/public/menu/{slug}` | — | `limit`, `cursor`, `search` | 200 | 403, 404 | Public / credential-specific |
| `GET` | `/public/menu/{slug}/categories` | — | `limit`, `cursor`, `search` | 200 | 403 | Public / credential-specific |

## Service health (2)

### Health

| HTTP | Path (append to `/api/v1`) | Request body | Query | 2xx | Other status codes | Access |
|---|---|---|---|---|---|---|
| `GET` | `/health/live` | — | — | 200 | default | Public / credential-specific |
| `GET` | `/health/ready` | — | — | 200 | 503 | Public / credential-specific |

## Named reference schemas (32)

`ApiError` · `PageMeta` · `RestaurantSummary` · `Plan` · `Subscription` · `RenewalContact` · `Branch` · `Category` · `ProductImage` · `Product` · `CreateCategory` · `CreateProduct` · `Floor` · `Area` · `RestaurantTable` · `QrData` · `TablePage` · `ServiceCall` · `VisitCreated` · `Employee` · `Shift` · `PushDevice` · `RealtimeEvent` · `CallAnalyticsTotals` · `CallAnalyticsDaily` · `CallAnalyticsReport` · `AdminAuditEntry` · `ManagedMedia` · `ProductGalleryImage` · `PlatformAdministrator` · `PlatformAdministratorResponse` · `PlatformAdministratorList`

## Important limitations / non-HTTP elements

- Endpoint inventory parity against generated Swagger is verified in backend CI; the static YAML still has operations with description-only success responses. Use runtime `/api/docs-json` for strict DTOs and all required/optional fields. Never infer missing response structure from mock fixtures.
- Push delivery is performed by a separate worker, **not** an additional public HTTP endpoint. Expo ticket acceptance is not proof of device delivery; do not display an acknowledgment state without a corresponding backend feature.
- There is no payment checkout API, order/payment management, web socket or hardware/ESP controller in V1.
- Service readiness `/health/live` and `/health/ready` do not imply S3/Expo/mobile usability. Full staging tests remain required.
- Mock-only `mocks/fixtures.json` contains non-UUID fixture IDs: those must never be used as real API credentials.

## Source and verification

This document is generated from the versioned `openapi/restaurant.v1.yaml` endpoint list and must be updated alongside backend controller/API changes. Runtime inventory parity test: `test/integration/swagger-completeness.spec.ts`. Detailed business rules: `docs/API_CONTRACTS.md`. Generated contract: `src/common/openapi/api-document.ts`. Any missing details in this handoff defer to actual DTO decorators + generated `/api/docs-json`.
