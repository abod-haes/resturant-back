# RBAC & tenant authorization — canonical policy

The authoritative capability matrix is [RBAC_MATRIX.md](./RBAC_MATRIX.md). This file intentionally does not maintain a second conflicting copy.

- `PRIMARY_ADMIN`: manages platform admins and platform operations.
- `PLATFORM_ADMIN`: manages restaurants, owners, plans and manual subscriptions but **has no implicit owner-level restaurant data access**.
- `RESTAURANT_OWNER`: manages only the restaurant and branches owned by the authenticated principal.
- `EMPLOYEE`: one branch/department, own shift and permitted branch call history.
- `PUBLIC`: published general menu or authenticated-by-QR table session and calls, subject to server policies.

Platform support/impersonation access is **DENY by default** until separately approved and audited. Hiding a UI action is never authorization. Guard sequence: authenticate, role, tenant, branch, subscription/plan, resource policy, then rate/cooldown/idempotency as applicable.
