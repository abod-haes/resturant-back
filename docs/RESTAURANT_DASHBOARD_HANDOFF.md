# Restaurant onboarding — Admin Dashboard handoff v1.4.0

**Backend:** `abod-haes/resturant-back`. Canonical live API generated at `GET /api/docs-json`. This slice uses `/api/v1`. Admin and owner dashboards are separate Vite apps within `retuarant-dash`; only admin app consumes these endpoints.

## Endpoint handshake
| Method | URL | Request | Response | Auth scope |
|---|---|---|---|---|
| POST | `/api/v1/admin/restaurants` | `{name,owner:{name,username,initialPassword},initialBranch:{name}}` | 201 `{data:{id,name,ownerId,branchId}}` | PRIMARY_ADMIN or PLATFORM_ADMIN |
| GET | `/api/v1/admin/restaurants?limit=20&cursor=&search=` | Opaque cursor from prior response | 200 `{data:[RestaurantSummary],meta:{nextCursor,hasMore}}` | same |
| GET | `/api/v1/admin/restaurants/:id` | UUID v4 | 200 `{data:RestaurantDetails}` | same |
| PATCH | `/api/v1/admin/restaurants/:id` | `{name?,isActive?}` | 200 `{data:RestaurantDetails}` | same |

`RestaurantSummary`: `{id,name,slug,isActive,createdAt,owner:{id,name,username}|null}`. `RestaurantDetails` adds `initialBranch:{id,name,slug,isActive}|null`. UTC timestamps, UUID v4 IDs. Never include the owner's password hash or initial password in any response.

## Errors and data rules
- 400 `VALIDATION_ERROR`: invalid name, username, short password, unknown nested properties, cursor, limit greater than 100, empty PATCH, bad UUID.
- 401 `UNAUTHORIZED`: missing/invalid session.
- 403 `FORBIDDEN` or `PASSWORD_CHANGE_REQUIRED`: unauthorized roles or mandatory initial password change.
- 404 `NOT_FOUND`: unknown restaurant.
- 409 `OWNER_USERNAME_TAKEN`: username already assigned (case-insensitive). No partial restaurant or branch persists after failure.
- Owner account is created with `mustChangePassword=true`; no subscription/plan assignment is done by this endpoint. Activating subscriptions is a separate manual admin feature. A disabled restaurant invalidates its users' auth on their next API request.
- Creation and update audit is atomic with the mutation; any error returns the standard envelope `{error:{code,message,details?},requestId}`.

## Dashboard integration requirements
Use one typed API adapter and a mock adapter sharing identical schema; fixture `mocks/contracts/restaurant-onboarding-v1.4.json` is an example only, not an executable API. Client list page size 20 by default, use `nextCursor` for subsequent pages, do **not** request 100 records at once. Handle 401/403/409/500 and non-empty/empty/offline/error states. Do not store admin credentials locally.

**Status:** Backend branch implementation and DB integration tests are required; cross-repo dashboard live integration remains BLOCKED until adapters, staging URL and smoke tests are verified. No dashboard repository edited by backend agent.
