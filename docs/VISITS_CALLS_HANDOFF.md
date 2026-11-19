# Visit Sessions & Staff Calls API — v1.8.0 backend handoff

Base: `/api/v1`; canonical generated Swagger `/api/docs-json`. JSON envelope {data,meta?}, error {error:{code,message,details?},requestId}.

## Customer site, no login
1. `GET /public/t/:qrToken` now returns dynamic `callsAvailable` based on table enabled flags, subscription and effective call settings.
2. `POST /public/t/:qrToken/sessions` (empty body) returns 201 {data:{sessionToken,expiresAt,firstCallNeedsConfirmation:true,availableCallTypes:["waiter"|"hookah"]}}. No raw QR token in response. Store the sessionToken only in browser visit state. Do not send it as a URL query, logs, analytics, localStorage or a push payload.
3. `POST /public/sessions/status` {sessionToken} -> 200 {data:{expiresAt,firstCallNeedsConfirmation,availableCallTypes}} and refreshes 4h idle expiry if still valid.
4. `POST /public/calls` {sessionToken,type:"waiter"|"hookah",idempotencyKey:UUIDv4,confirmFirstCall?:boolean} -> 201 {data:{id,type,deliveryState:"queued"|"no_staff",createdAt,recipientsCount,ownerAlerted,firstCallNeedsConfirmation:false}}. If firstCallNeedsConfirmation=true, show confirmation modal and include confirmFirstCall:true only after user accepts. Do not confirm or show success before HTTP success.
5. 429 COOLDOWN_ACTIVE includes `error.details.retryAfterSeconds`; 409 FIRST_CALL_CONFIRMATION_REQUIRED needs modal; 401 SESSION_EXPIRED means scan/restart visit; 404 QR_REVOKED means table code disabled or rotated; 403 CALLS_DISABLED, CALL_TYPE_DISABLED, SUBSCRIPTION_INACTIVE mean hide/disable call buttons.

Important: queue state means call saved + recipient pending rows **only**; it does not mean a phone received push. no_staff means call saved + owner dashboard alert saved. Use user-safe text: `تم تسجيل طلبك`. No call accept/complete.

## Owner dashboard (bearer RESTAURANT_OWNER)
- `GET/POST /owner/employees`; POST {username,name,initialPassword,branchId,department:"waiter"|"hookah"}. `GET ?branchId=&cursor=&limit=20`, PATCH /owner/employees/:id {name?,isActive?,department?}, DELETE archive, POST /owner/employees/:id/reset-password {initialPassword}, POST /owner/employees/:id/end-shift. Every creation respects maxEmployees plan quota including disabled (archived frees); reset revokes sessions and forces first-login change.
- `GET/PATCH /owner/call-settings` restaurant default with {enabled,waiterEnabled,hookahEnabled,routingMode:"all_on_shift"|"department_on_shift",shiftAutoEndMinutes:60..1440}. `GET/PATCH /owner/branches/:branchId/call-settings` override same booleans/mode; PATCH null resets branch override. UI should distinguish inherited/default values if desired.
- `GET /owner/calls?branchId=&type=&limit=20&cursor=` and `GET /owner/alerts?branchId=&limit=20&cursor=` are paginated tenant-scoped. An alert row is created when no employee on shift. There is no realtime transport; poll as appropriate. `owner/call-analytics` is planned only.

## Employee Expo (bearer EMPLOYEE)
- `POST /employee/shifts/start`, `POST /employee/shifts/end`, `GET /employee/shifts/current`. One open shift/employee; autoEndAt limits eligibility, default 12h configured by owner; expired open shift finalized on next start. Only branch and assigned department can be used; requires active plan.
- `GET /employee/calls?type=&limit=20&cursor=` reads only calls addressed to authenticated employee ID in call_outbox. No accept/complete; pending does not confirm push delivery.

## Deployment and explicit limitations
- Backend requires PostgreSQL forward migrations before releasing v1.8.
- Push device API, native notification sounds, WebSockets/SSE, external owner WhatsApp/SMS and async outbox consumer have NOT been implemented in this PR. **Do not enable an employee device push UI or claim notification delivery.**
- Owner/customer/Expo frontend repos were not modified in this backend PR; end-to-end staging adapters and user acceptance testing remain BLOCKED.

## v1.9 extension
Backend now exposes authenticated owner/employee SSE events, employee Expo device registration and an optional push worker. See `docs/PUSH_REALTIME_HANDOFF.md`. No change to POST /public/calls payload or deliveryState semantics; queued is still not a handset acknowledgment.
