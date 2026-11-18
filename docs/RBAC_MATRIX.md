# RBAC & scope matrix — proposed implementation baseline
Roles: PRIMARY_ADMIN, PLATFORM_ADMIN, RESTAURANT_OWNER, EMPLOYEE, PUBLIC.
Scope: GLOBAL, RESTAURANT, BRANCH, OWN_RESOURCE. Backend checks role + resource ownership + plan/feature + active state.

| Resource/action | Primary | Platform admin | Owner | Employee | Public |
|---|---|---|---|---|---|
| Create/manage platform admins | allow | deny | deny | deny | deny |
| Create restaurants/owners | allow | allow | deny | deny | deny |
| Plans/subscription manual activation | allow | allow | deny | deny | deny |
| Platform audit logs | allow | allow (policy-limited) | deny | deny | deny |
| Owner branches/settings | support only (audited) | support only (audited) | own restaurant | deny | deny |
| Categories/products/templates | support only (audited) | support only (audited) | own branch | deny | read published |
| Tables/QR rotate/disable | support only (audited) | support only (audited) | own branch | deny | QR view if valid |
| Employee accounts/password reset | support only (audited) | support only (audited) | own branch | deny | deny |
| Shift start/end | deny | deny | end own employees | own shift | deny |
| Calls/history/analytics | support only (audited) | support only (audited) | own branches | own branch relevant calls | create via valid QR session |
| Owner alerts | support only (audited) | support only (audited) | own branches | deny | deny |
| General public menu | allow | allow | allow | allow | read published |

**Support access is not an approved business feature**: default DENY until an explicit audited impersonation/support policy is approved. In implementation treat 'support only' cells as DENY. Platform admin audit visibility and permission delegation require explicit policy before production.

Guards: authenticate -> role -> tenant -> branch -> subscription/plan -> resource policy -> rate limit/idempotency (where applicable). Never trust tenant IDs supplied by client; derive scope from authenticated principal and verify ownership.

## Tests
Cross-tenant access, branch spoofing, horizontal IDOR, owner to platform privilege escalation, employee other-branch calls, expired subscription, archived resources, token reuse and QR rotation.
