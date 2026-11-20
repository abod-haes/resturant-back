# Platform administrator API handoff — v1.12

All routes use /api/v1 and require Bearer JWT with PRIMARY_ADMIN role. PLATFORM_ADMIN cannot manage other global accounts.

| Method | Endpoint | Behavior |
|---|---|---|
| POST | /admin/platform-admins | Create a PLATFORM_ADMIN; HTTP 201 |
| GET | /admin/platform-admins | Cursor list; limit=20 default, max 100; optional literal name/username search |
| GET | /admin/platform-admins/:id | Get one global administrator |
| PATCH | /admin/platform-admins/:id | Change name or active status |
| POST | /admin/platform-admins/:id/reset-password | Reset initial password; HTTP 200 |

Create request: name (nonblank, 200 max), username (3–64 ASCII username chars), initialPassword (12–128 characters). The caller never supplies the role or tenant: a global PLATFORM_ADMIN with null restaurant/branch/department scope is created. A new account MUST change its password on initial login using /auth/change-password.

Account output: {id,username,name,role:"PLATFORM_ADMIN",isActive,mustChangePassword,createdAt}; no password hash or refresh credential. List: {data:[...],meta:{nextCursor,hasMore}}. A given cursor must be passed back opaquely.

Deactivate revokes all sessions immediately. Reactivate never resurrects revoked sessions. Reset sets mustChangePassword=true, revokes all active sessions and never returns a password. All writes record actor, target, requestId and nonsensitive metadata in audit_logs.

Expected errors: 400 invalid body/limit/cursor, 401 missing/invalid access, 403 wrong role or password change required, 404 unknown/non-PLATFORM_ADMIN UUID, 409 PLATFORM_ADMIN_USERNAME_TAKEN. A PRIMARY_ADMIN account cannot be changed through these routes. No create-primary, delete, or role escalation API exists.

Frontend handoff: use actual generated Swagger at /api/docs-json, validate real staging auth/permissions and keyset pagination, display expired sessions as signed-out, and never cache initial credentials. This backend slice does not claim that any dashboard has been connected or a staging smoke test passed.
