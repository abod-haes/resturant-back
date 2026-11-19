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
- GET/POST/PATCH /owner/branches/:branchId/tables
- POST /owner/tables/:tableId/qr/rotate; POST /owner/tables/:tableId/qr/disable; GET /owner/branches/:branchId/qr/print
- GET/POST/PATCH /owner/employees; POST /owner/employees/:id/reset-password; POST /owner/employees/:id/end-shift
- GET /owner/calls?branchId=&type=&from=&to=&cursor=&limit=
- GET /owner/call-analytics; GET /owner/alerts
- PATCH /owner/branches/:branchId/call-settings {enabled,waiterEnabled,hookahEnabled,routingMode?}
- GET /owner/subscription (implemented v1.5.0 as above)

## Public
- GET /public/menu/:slug?limit=20&cursor=&search= -> {data:{restaurant:{name},branch:{name,slug,currency|null},products:Product[],categories:Category[]},meta:PageMeta}. Public products are limited to published/nonarchived products in active categories; sold-out products remain visible with isSoldOut=true, hidden/archived are excluded. categories contains only categories for that product page.
- GET /public/menu/:slug/categories?limit=20&cursor=&search= -> paginated active categories so the UI can fetch its complete category index independently.
- No session token, QR credential, staff-call buttons or location validation in public catalog responses; subscription must be operational with menu feature. Read-only endpoint is separate from future table QR flow.
- GET /public/t/:qrToken -> {restaurant,branch,table,menu,callSettings}
- POST /public/t/:qrToken/sessions -> {sessionToken,expiresAt,firstCallNeedsConfirmation}
- POST /public/calls {sessionToken,type,idempotencyKey} -> {id,createdAt,deliveryState,ownerAlerted}
  - Server validates subscription, table, QR, session, branch, enabled buttons, 10-second cooldown per table/type.
  - `deliveryState` indicates queued/no-staff, not actual employee acknowledgement.
  - No GPS in V1. A static QR/session is not proof of physical presence.

## Employee
- POST /employee/shifts/start; POST /employee/shifts/end; GET /employee/shifts/current
- GET /employee/calls?cursor=&limit=
- POST /employee/devices {expoPushToken,platform}
- DELETE /employee/devices/:id

## Events
- Realtime `call.created`, `owner.alert.created`, `shift.updated`, `menu.updated`
- Event envelope {eventId,eventType,occurredAt,branchId,payload}; reconnect uses paginated GET as source of truth.

## Shared errors
UNAUTHORIZED, FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, SUBSCRIPTION_INACTIVE, QR_REVOKED, TABLE_DISABLED, CALLS_DISABLED, CALL_TYPE_DISABLED, SESSION_EXPIRED, COOLDOWN_ACTIVE (retryAfterSeconds), RATE_LIMITED, NO_STAFF_AVAILABLE (call may still be recorded), INTERNAL_ERROR.

## Contract change protocol
1. Update backend canonical contract and OpenAPI schema first.
2. Increment contract version, add changelog and examples; preserve backward compatibility or coordinate breaking release.
3. Update shared fixtures and MSW/Expo mock adapters in all consumer repos in same change set.
4. Run schema and fixture validation, contract tests, then client CI.
5. Notify all three client owners; never silently rename fields or alter semantics.
