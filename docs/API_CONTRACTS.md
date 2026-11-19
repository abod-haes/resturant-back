# API Contract — v1 (Draft)
Base path: `/api/v1`. JSON envelope: `{data,meta?}`; errors: `{error:{code,message,details?},requestId}`. All IDs UUID strings, dates ISO-8601 UTC, money integer minor units plus currency. Tenant authorization is enforced server-side.

## Authentication — implemented slice v1.3.0
- POST /auth/login {username,password,client?:"web"|"mobile"} -> {data:{accessToken,expiresAt,user,refreshToken?}}; defaults to web mode, with refresh credential only in HttpOnly cookie. Mobile receives refreshToken in JSON for OS secure storage. Access JWT 15m, rotating refresh session up to 30d.
- POST /auth/refresh accepts optional {refreshToken} for mobile or HttpOnly cookie + trusted Origin for web; invalid/replayed credentials return 401 (replay revokes active session). Both rotate refresh credential.
- POST /auth/logout accepts same refresh credentials; revokes corresponding session and access token immediately.
- GET /auth/me uses bearer JWT -> {data:{id,role,restaurantId,branchId,department,mustChangePassword}}.
- POST /auth/change-password {currentPassword,newPassword} uses bearer; new password 12–128 chars; response {data:{changed:true}} and **all sessions revoked**, client must log in again.
- Errors maintain {error:{code,message,details?},requestId}. 401 invalid/missing auth; 403 PASSWORD_CHANGE_REQUIRED; 429 RATE_LIMITED. Initial password change is mandatory before access to business endpoints.
- All endpoints are deny-by-default unless explicitly @Public or protected with roles / authenticated policy. Resource scope checked server-side, never from client-submitted tenant fields.
- Browser cookie mode assumes a trusted same-site deployment and explicit CORS_ORIGINS entry; cookie refresh/logout requires an Origin matching CORS_ORIGINS. Mobile mode never persists credentials in AsyncStorage/localStorage.

## Platform — restaurant onboarding implemented v1.4.0
- POST /admin/restaurants request {name,owner:{name,username,initialPassword},initialBranch:{name}} -> 201 {data:{id,name,ownerId,branchId}}. Creates all records and audit in one database transaction. Owner must change the initial password on first sign-in. No plan/subscription auto-activation. Tenant slug generated server-side and remains stable.
- GET /admin/restaurants?limit=20&cursor=&search= -> {data:[{id,name,slug,isActive,createdAt,owner:{id,name,username}|null}],meta:{nextCursor,hasMore}}. Limit 1–100; keyset sorted by createdAt DESC,id DESC. Search literal case-insensitive substring (no wildcard semantics).
- GET /admin/restaurants/:id -> {data:{...summary,initialBranch:{id,name,slug,isActive}|null}}.
- PATCH /admin/restaurants/:id accepts {name?,isActive?} with at least one field -> updated detail. When disabled, owner sessions become invalid on their next request.
- Admin endpoints require bearer access token and role PRIMARY_ADMIN or PLATFORM_ADMIN; no owner or employee access. Client-supplied tenant identifiers are not accepted. Audit create/update with requestId; no passwords returned or logged.
- Errors: 400 VALIDATION_ERROR (DTO/cursor), 401 UNAUTHORIZED, 403 FORBIDDEN or PASSWORD_CHANGE_REQUIRED, 404 NOT_FOUND, 409 OWNER_USERNAME_TAKEN for username collision; errors use {error:{code,message,details?},requestId}.
## Plans & subscriptions — implemented slice v1.5.0
- GET /admin/plans?limit=&cursor= -> {data:[Plan],meta:{nextCursor,hasMore}} (default 20 max 100, newest first); GET /admin/plans/:id -> {data:Plan}.
- POST /admin/plans {name,maxBranches,maxTables,maxEmployees,features:{menu,waiter_calls,hookah_calls,analytics}} -> 201 {data:Plan}. All four feature flags are required booleans, limits integers; PATCH /admin/plans/:id accepts partial fields, feature flags merged. Existing active subscription snapshots do not change when a plan is edited. Disabling a plan blocks new activations/renewals, not currently granted rights.
- POST /admin/restaurants/:restaurantId/subscriptions {planId,period:"monthly"|"yearly"} -> 201 {data:Subscription} with effectiveStatus=pending. One pending draft per restaurant.
- GET /admin/restaurants/:restaurantId/subscription -> {data:Subscription|null}.
- POST /admin/subscriptions/:id/activate {startsAt?:UTC ISO Z,graceDays:0..365} -> {data:Subscription}; only pending subscription. At most one active subscription per restaurant; an old expired record is archived atomically when a replacement is activated.
- POST /admin/subscriptions/:id/renew {period?:monthly|yearly,graceDays:0..365} -> {data:Subscription}. Manual only; monthly/yearly UTC calendar clamping (Jan 31 -> Feb 28/29). Renews from the previous end while active or during grace; after grace starts from now. Preserves per-term history and keeps the original active window start on early renewal.
- Subscription: {id,restaurantId,planId,period,effectiveStatus:pending|scheduled|active|grace|expired|cancelled,canOperate,startsAt,endsAt,graceEndsAt,graceDays,entitlements:{maxBranches,maxTables,maxEmployees,features}|null}. Effective status is derived at read time; grace allows operation until graceEndsAt (exclusive).
- GET /admin/contact-methods -> {data:Contact[]}; PATCH /admin/contact-methods {contacts:[{type:whatsapp|phone|email,label,value,enabled}]} -> atomic replacement and audit, max 10.
- GET /owner/subscription -> {data:{subscription:Subscription|null,canOperate,renewalContacts:enabledContacts[]}}. Allows owner to see renewal channels even after expiry, with no payment checkout/auto-renewal.
- Server-side policy SubscriptionsService.assertOperational(restaurantId,feature?) is available; **future** owner/employee/customer operational routes must call it, and enforce plan quotas inside their own database transaction. This slice does NOT claim to enforce branch/table/employee limits on routes not yet implemented.
- All admin endpoints require PRIMARY_ADMIN or PLATFORM_ADMIN; owner reads own restaurant only. Errors use standard envelope and may include PLAN_NAME_TAKEN, PLAN_UNAVAILABLE, SUBSCRIPTION_PENDING, SUBSCRIPTION_NOT_PENDING, SUBSCRIPTION_ALREADY_ACTIVE, SUBSCRIPTION_NOT_RENEWABLE, PLAN_FEATURE_DISABLED, SUBSCRIPTION_INACTIVE. No payment endpoints.
- GET /admin/audit-logs (planned; not implemented)

## Owner — Branches & Menu implemented slice v1.6.0
- GET /owner/branches?limit=20&cursor= -> {data:Branch[],meta:{nextCursor,hasMore}}; POST /owner/branches {name,currency?:ISO4217} -> 201 {data:Branch}. GET /owner/branches/:branchId -> {data:Branch}. PATCH /owner/branches/:branchId {name?,currency?,isActive?} -> {data:Branch}. Branch={id,name,slug,currency|null,isActive,createdAt}. All reads/mutations need active subscription; branch create checks maxBranches under a restaurant row lock, counting disabled branches too. Initial onboarding branch currency is null until owner configures it. Currency changes are rejected when that branch already has products.
- GET /owner/branches/:branchId/categories?limit=20&cursor=&search= -> {data:Category[],meta:PageMeta}; POST category {name,description?,sortOrder?,isActive?}; GET/PATCH /owner/branches/:branchId/categories/:id; DELETE /owner/branches/:branchId/categories/:id archives without deleting historical products.
- GET /owner/branches/:branchId/products?limit=20&cursor=&search= -> {data:Product[],meta:PageMeta}; POST product {categoryId,name,description?,priceMinor,oldPriceMinor?,tags?,isVisible?,isSoldOut?,sortOrder?,images?:[{url,alt?}]}; GET/PATCH /owner/branches/:branchId/products/:id; DELETE archives product. Products require configured branch currency. priceMinor integer 0..2147483647, oldPriceMinor must exceed priceMinor, tags max 12, images max 8. Images are metadata references on approved HTTPS `MEDIA_ALLOWED_ORIGINS`, **not uploaded or optimized by this slice**. Empty allowlist rejects all image URLs.
- POST /owner/branches/:branchId/menu/copy-from {sourceBranchId,includeTemplate?:false} -> 201 {data:{categoriesCopied,productsCopied}}. Only same-tenant active source/target, empty target; copies live categories/products and associated image metadata with new IDs. Changes to target never affect source. includeTemplate:true rejected as unsupported until floor/table feature. No overwrite of existing menu.
- Category={id,branchId,name,description|null,sortOrder,isActive,createdAt}. Product={id,branchId,categoryId,name,description|null,priceMinor,oldPriceMinor|null,currency,tags,isVisible,isSoldOut,sortOrder,images:[{id,url,alt|null,sortOrder}],createdAt}.
- All owner endpoints require RESTAURANT_OWNER + own restaurant/active branch, `menu` feature active/grace. No admins implicitly impersonate owners. Errors include SUBSCRIPTION_INACTIVE, PLAN_FEATURE_DISABLED, PLAN_LIMIT_REACHED, BRANCH_CURRENCY_REQUIRED, BRANCH_CURRENCY_IN_USE, CATEGORY_NAME_TAKEN, INVALID_OLD_PRICE, MEDIA_ORIGIN_NOT_ALLOWED, MENU_TARGET_NOT_EMPTY, MENU_CURRENCY_MISMATCH; UUID/validation errors 400, unauthorized 401, role/plan 403, cross-tenant ID 404, conflicts 409.
## Owner floors, areas, tables and QR — implemented v1.7.0
- GET/POST /owner/branches/:branchId/floors?limit=20&cursor=; PATCH/DELETE /owner/branches/:branchId/floors/:id. Floor={id,branchId,name,sortOrder,isActive}; create {name,sortOrder?}, patch {name?,sortOrder?,isActive?}; DELETE soft-archives only when no nonarchived areas exist. Pagination sortOrder ASC,id ASC.
- GET/POST /owner/branches/:branchId/areas?limit=20&cursor=; PATCH/DELETE /owner/branches/:branchId/areas/:id. Area={id,branchId,floorId,name,sortOrder,isActive}; create {floorId,name,sortOrder?}, patch {floorId?,name?,sortOrder?,isActive?}; DELETE soft-archives only if no nonarchived tables exist. Area floor must be active and in the same branch.
- GET/POST /owner/branches/:branchId/tables?limit=20&cursor=; GET/PATCH/DELETE /owner/branches/:branchId/tables/:id; POST /owner/branches/:branchId/tables/bulk {areaId,labels:[1..50]}. Table={id,branchId,areaId,label,sortOrder,isActive,qrEnabled,callsEnabled,qrVersion}. POST {areaId,label,sortOrder?}; PATCH {areaId?,label?,sortOrder?,isActive?,qrEnabled?,callsEnabled?}; DELETE soft-archives table and revokes current QR. Archive frees table quota; inactive tables remain counted. `maxTables` enforced restaurant-wide inside locked transaction across parallel create and bulk requests; all-or-nothing.
- GET /owner/tables/:tableId/qr -> {data:{url,version,enabled}}; POST /owner/tables/:tableId/qr/rotate -> 200 same (creates a new 256-bit token, revokes old, increments version, preserves enable state); POST /owner/tables/:tableId/qr/disable -> 200 {data:{enabled:false,version}}. To re-enable: PATCH table {qrEnabled:true}; this does not rotate the token.
- GET /owner/branches/:branchId/qr/print?tableIds=comma-separated-uuid-list -> A4 application/pdf download, 6 QR stickers/page, max 100 active/enabled tables. Without tableIds prints up to 100. `Cache-Control:no-store`. Non-ASCII sticker label falls back to short table ID until Arabic PDF font support; QR itself scans correctly.
- QR tokens are random 256-bit base64url, looked up by SHA-256 digest and stored encrypted with AES-256-GCM; raw token never in listings, audit logs or DB plaintext. Requires `QR_TOKEN_ENCRYPTION_KEY` (64 hex) and `CUSTOMER_APP_ORIGIN` (HTTPS origin) set on server before issuing/printing QR. Existing backend without keys still starts, but QR creation/rotation/printing returns 503 `QR_NOT_CONFIGURED`.
- Owner-only endpoints require RESTAURANT_OWNER and tenant/branch scope, plus operational subscription. Tables require the plan's menu feature at creation. Area and floor activation/archival are respected by public QR. Documented errors: PLAN_LIMIT_REACHED (403), QR_NOT_CONFIGURED (503), QR_REVOKED (404 public /409 owner read), TABLE_LABEL_TAKEN, AREA_NAME_TAKEN, FLOOR_NAME_TAKEN, FLOOR_NOT_EMPTY, AREA_NOT_EMPTY, DUPLICATE_TABLE_LABELS; cross-tenant resource always 404.

## Owner employees and routing — implemented v1.8.0
- GET/POST /owner/branches/:branchId/employees. Create {username,displayName,initialPassword,department:"waiter"|"hookah"} -> 201 {data:Employee}, listing {data:Employee[]} (capped 100). No passwords returned. Employee quota counts all employee accounts under restaurant lock; initial password change mandatory.
- POST /owner/shifts/:id/force-end -> 200 {data:Shift}, only own tenant's shift.
- GET/PATCH /owner/call-routing with {routingMode:"all"|"department"}. Default department.
- GET/PATCH /owner/branches/:branchId/call-routing with {routingMode?:"all"|"department"|null,shiftMaxMinutes?:60..1440}. Null inherits restaurant default; shift duration defaults 720min.
- GET /owner/calls?limit=20&cursor= -> {data:Call[],meta:PageMeta}; GET /owner/alerts?limit=20 -> {data:OwnerAlert[]}; POST /owner/alerts/:id/read -> {data:OwnerAlert}. Owner alert means stored dashboard record, not external delivery.
- Owner password reset, employee deletion, call analytics and external owner messaging remain PLANNED, NOT implemented.
- GET /owner/subscription (implemented v1.5.0 as above)

## Public
- GET /public/menu/:slug?limit=20&cursor=&search= -> {data:{restaurant:{name},branch:{name,slug,currency|null},products:Product[],categories:Category[]},meta:PageMeta}. Public products are limited to published/nonarchived products in active categories; sold-out products remain visible with isSoldOut=true, hidden/archived are excluded. categories contains only categories for that product page.
- GET /public/menu/:slug/categories?limit=20&cursor=&search= -> paginated active categories so the UI can fetch its complete category index independently.
- No session token, QR credential, staff-call buttons or location validation in public catalog responses; subscription must be operational with menu feature. Read-only endpoint is separate from future table QR flow.
- GET /public/t/:qrToken -> {data:{restaurant,branch,table,menuPath,callsAvailable:boolean,availableCallTypes:("waiter"|"hookah")[]}}. Only active QR with permitted features; no visit secret in the read response. General public menu has no calls.
- POST /public/t/:qrToken/sessions -> 201 {data:{sessionToken,expiresAt,firstCallNeedsConfirmation:true,availableCallTypes}}. Session token is 256-bit random, SHA-256 at rest, 4h idle expiry; 30 new sessions/table/minute cap (429). No QR proof of physical location.
- POST /public/sessions/heartbeat {sessionToken} -> 200 {data:{expiresAt,firstCallNeedsConfirmation,availableCallTypes}}; slides idle expiry only for active session/current QR. Expired 401 SESSION_EXPIRED; revoked 404 QR_REVOKED.
- POST /public/calls {sessionToken,type:"waiter"|"hookah",idempotencyKey:UUIDv4,firstCallConfirmed?:true} -> 200 {data:{id,tableId,type,createdAt,deliveryState:"queued"|"no_staff",ownerAlerted}}. First call needs explicit confirmation (409). Same session+key/type replay returns original receipt; key reused for different type -> 409 IDEMPOTENCY_KEY_REUSED. Atomic 10s per-table/type cooldown across sessions -> 429 COOLDOWN_ACTIVE with details.retryAfterSeconds. Expired/disabled plan, table, branch or button rejected.
- "queued" means recipients and pending outbox stored; NOT pushed or delivered. "no_staff" means call stored and owner DASHBOARD alert persisted; NOT externally notified. No device registration, realtime worker or push in v1.8.

## Employee — implemented v1.8.0
- POST /employee/shifts/start -> 201 {data:Shift}, one active shift and timed effective expiration based on shiftMaxMinutes. POST /employee/shifts/end -> 200 {data:Shift}. GET /employee/shifts/current -> {data:Shift|null} with isOnShift derived from time and endedAt. Password change required.
- GET /employee/calls?limit=20&cursor= -> {data:Call[],meta:PageMeta} scoped to individual recipients/branch; no accept/complete in V1.
- POST /employee/devices and DELETE /employee/devices/:id remain PLANNED; no active push integration.

## Events
- call_delivery_outbox pending rows are persisted in the same call transaction. There is no active worker or realtime/push delivery. Owner and employee paginated call history are current read sources; socket events remain planned.

## Shared errors
UNAUTHORIZED, FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, SUBSCRIPTION_INACTIVE, QR_REVOKED, TABLE_DISABLED, CALLS_DISABLED, CALL_TYPE_DISABLED, SESSION_EXPIRED, COOLDOWN_ACTIVE (retryAfterSeconds), RATE_LIMITED, NO_STAFF_AVAILABLE (call may still be recorded), INTERNAL_ERROR.

## Contract change protocol
1. Update backend canonical contract and OpenAPI schema first.
2. Increment contract version, add changelog and examples; preserve backward compatibility or coordinate breaking release.
3. Update shared fixtures and MSW/Expo mock adapters in all consumer repos in same change set.
4. Run schema and fixture validation, contract tests, then client CI.
5. Notify all three client owners; never silently rename fields or alter semantics.
