# Auth v1.3.0 — API handoff to Dashboards and Employee Expo app

**Source of truth:** backend generated `/api/docs-json` once deployed, plus `docs/API_CONTRACTS.md`. Requires PostgreSQL migration 20261119190000 and runtime AUTH_ACCESS_SECRET. This is **implemented backend contract**, not yet staging-verified across clients.

| Method | Path | Body | Response `data` | Scope |
|---|---|---|---|---|
| POST | `/api/v1/auth/login` | `{username,password,client?:web\|mobile}` | `{accessToken,expiresAt,user,refreshToken?}` | public |
| POST | `/api/v1/auth/refresh` | web `{}`, mobile `{refreshToken}` | same login response | cookie+trusted Origin OR mobile token |
| POST | `/api/v1/auth/logout` | web `{}`, mobile `{refreshToken}` | `{loggedOut:true}` | refresh credential |
| GET | `/api/v1/auth/me` | none | `{id,role,restaurantId,branchId,department,mustChangePassword}` | Bearer |
| POST | `/api/v1/auth/change-password` | `{currentPassword,newPassword}` | `{changed:true}` | Bearer |

Sample login web response (no refreshToken in JSON):
```json
{"data":{"accessToken":"<opaque-jwt>","expiresAt":"2026-11-19T20:15:00.000Z","user":{"id":"<uuid>","role":"RESTAURANT_OWNER","restaurantId":"<uuid>","branchId":null,"department":null,"mustChangePassword":true}}}
```

**Web client:** fetch/axios with credentials when posting refresh and logout, exact trusted `Origin`, and keep access JWT in memory. Read `mustChangePassword` and route to change password; after success redirect to login. Configure secure same-site cookie deployment, not cross-site without further design. Handle 401 by resetting auth state, 403 `PASSWORD_CHANGE_REQUIRED` with change-password route, 429 with appropriate feedback.

**Expo client:** POST login `client:"mobile"`; save only rotating refresh credential to SecureStore; update stored credential atomically after successful refresh, don't reuse old token, keep access token in memory. Support 401 sign-out. Employees cannot access other branches.

**Security semantics:** Roles: PRIMARY_ADMIN, PLATFORM_ADMIN, RESTAURANT_OWNER, EMPLOYEE. Auth and scope determined from DB each request. No platform admin implicit owner data access. Access expires in 15 minutes; refresh rotates, absolute session availability up to 30 days from each rotation. No data pagination on auth endpoints.

**Client integration status:** BLOCKED until the UI mock/live adapters match this contract, staging auth smoke tests are run and production cookie origins are configured.
