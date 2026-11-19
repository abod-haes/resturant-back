# Plans & Subscriptions — Admin and Owner Dashboard handoff v1.5.0

Backend `resturant-back`, base `/api/v1`. Authenticate with bearer JWT. Admin routes require PRIMARY_ADMIN or PLATFORM_ADMIN, owner route requires RESTAURANT_OWNER and reads only the authenticated tenant. Never infer tenant ID from owner UI.

| Method | Route | Body | Response |
|---|---|---|---|
| GET | /admin/plans?limit=20&cursor= | — | {data:Plan[],meta:{nextCursor,hasMore}} |
| POST | /admin/plans | {name,maxBranches,maxTables,maxEmployees,features:{menu,waiter_calls,hookah_calls,analytics}} | 201 {data:Plan} |
| GET | /admin/plans/:id | — | {data:Plan} |
| PATCH | /admin/plans/:id | Partial Plan fields including partial features, isActive | {data:Plan} |
| POST | /admin/restaurants/:restaurantId/subscriptions | {planId,period:"monthly"|"yearly"} | 201 {data:Subscription} |
| GET | /admin/restaurants/:restaurantId/subscription | — | {data:Subscription|null} |
| POST | /admin/subscriptions/:id/activate | {startsAt?:UTC ISO Z,graceDays:number} | {data:Subscription} |
| POST | /admin/subscriptions/:id/renew | {period?:"monthly"|"yearly",graceDays:number} | {data:Subscription} |
| GET | /admin/contact-methods | — | {data:Contact[]} |
| PATCH | /admin/contact-methods | {contacts:[{type,label,value,enabled}]} | {data:Contact[]} |
| GET | /owner/subscription | — | {data:{subscription:Subscription|null,canOperate,renewalContacts:Contact[]}} |

Plan includes id, name, maxBranches, maxTables, maxEmployees, 4 feature booleans, isActive, createdAt.
Subscription includes id, restaurantId, planId, period, effectiveStatus, canOperate, startsAt, endsAt, graceEndsAt, graceDays, entitlements (snapshot or null).
Contact type `whatsapp|phone|email`, label, value, enabled. Owner sees only enabled channels; empty array if none configured.
All dates ISO UTC; IDs UUID; no prices or payment endpoints. Errors `{error:{code,message,details?},requestId}`; important codes: `SUBSCRIPTION_PENDING`, `SUBSCRIPTION_ALREADY_ACTIVE`, `PLAN_UNAVAILABLE`, `SUBSCRIPTION_NOT_PENDING`, `SUBSCRIPTION_NOT_RENEWABLE`, `SUBSCRIPTION_INACTIVE`, `PLAN_FEATURE_DISABLED`, `PLAN_NAME_TAKEN`.

## Required UI states
Show pending, scheduled, active, grace and expired distinctly. In grace show explicit graceEndsAt. For expired, show admin contact details, **do not show payment or checkout**. After successful manual renewal, refresh owner subscription query. Admin can set graceDays explicitly; there is no default billing-policy duration. List plans using cursor 20 default, never request 100 by default.

## Gating and status
This Backend slice supports policy evaluation and owner read. Future menu/branch/table/call/employee routes must integrate the server subscription guard and quotas transactionally. Mock/live adapters and full staging smoke tests remain BLOCKED until dashboard integrations are implemented; no frontend repository was changed here.
