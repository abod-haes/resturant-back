# OpenAPI implementation contract — v1.2 (design baseline)
Canonical base `/api/v1`. Response `{data,meta?}`; error `{error:{code,message,details?},requestId}`. UUID IDs, ISO UTC timestamps, integer money minor units with explicit currency, booleans, enum strings. This is a **draft**, not generated verified OpenAPI.
## Pagination
`GET` collections accept `cursor`, `limit` default 20 max 100, `sort` whitelisted, `search` optional. Return `{data:[...],meta:{nextCursor:string|null,hasMore:boolean}}`. Never return 100 by default. Cursor is opaque, stable sort with id tiebreaker.
## Auth
POST /auth/login request {username,password} -> {data:{accessToken,expiresAt,user:{id,role,restaurantId?,branchId?}}}; POST /auth/refresh rotates refresh; POST /auth/logout revokes; GET /auth/me. Refresh credential HttpOnly Secure SameSite cookie on web; mobile secure credential storage. Never log credentials. Require CSRF mitigation when using cookies.
## Platform
GET/POST /admin/restaurants; PATCH /admin/restaurants/:id; GET/POST/PATCH /admin/plans; POST /admin/subscriptions/:id/activate|renew; GET/PATCH /admin/contact-methods; GET /admin/audit-logs. Create restaurant request {name,owner:{name,username,initialPassword},initialBranch:{name}}; response {id,name,ownerId,branchId}. Plan request {name,maxBranches,maxTables,maxEmployees,features}. Subscription activation {planId,period:"monthly"|"yearly",startsAt?}. No payment endpoints.
## Owner
GET/POST/PATCH /owner/branches; GET/PATCH /owner/settings; GET/POST/PATCH /owner/branches/:branchId/categories, /products, /tables. Product create {categoryId,name,description?,priceMinor,currency,oldPriceMinor?,images?,tags?,availability,sortOrder}; table {areaId,number,callsEnabled,qrEnabled}. POST /owner/branches/:branchId/menu/copy-from {sourceBranchId,includeTemplate}. POST /owner/tables/:id/qr/rotate, /qr/disable; GET /owner/branches/:branchId/qr/print. GET/POST/PATCH /owner/employees; POST /owner/employees/:id/reset-password; POST /owner/employees/:id/end-shift. GET /owner/calls and /owner/alerts and /owner/call-analytics. PATCH /owner/branches/:id/call-settings. GET /owner/subscription.
## Public
GET /public/menu/:slug -> {restaurant,branch,categories,products}; no table/session/call credentials. GET /public/t/:qrToken -> {restaurant,branch,table,menu,callSettings}; POST /public/t/:qrToken/sessions -> {sessionToken,expiresAt,firstCallNeedsConfirmation}. POST /public/calls {sessionToken,type:"waiter"|"hookah",idempotencyKey} -> {id,createdAt,deliveryState:"queued"|"no_staff",ownerAlerted}. 429 cooldown error includes retryAfterSeconds. First confirmation is client UX; server never trusts client confirmation as security.
## Employee
POST /employee/shifts/start, /end; GET /employee/shifts/current, /calls?cursor&limit; POST /employee/devices {expoPushToken,platform}; DELETE /employee/devices/:id.
## Events
call.created, owner.alert.created, shift.updated, menu.updated: {eventId,eventType,occurredAt,branchId,payload}. GET history is source of truth after reconnect.
## Required DTO definitions
CreateRestaurant, Restaurant, Plan, Subscription, Branch, Category, Product, Floor, Area, Table, Employee, Shift, ServiceCall, OwnerAlert, MenuResponse, VisitSession, ApiError, PageMeta. Define with Nest DTOs + class-validator or Zod and emit actual OpenAPI from code. Use discriminated error codes; ensure 401/403/404/409/410/422/429/500 documented.
## Unresolved implementation choices
Explicit support access policy, plan grace semantics, exact refresh-token rotation transport, QR public URL scheme, and external owner alert provider must be signed off before production. Do not invent business approvals.
