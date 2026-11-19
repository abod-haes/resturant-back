# QR visits, calls and workforce — API v1.8 handoff

Backend: `resturant-back`, base `/api/v1`. Bearer authentication required for owner and employee routes; public sessions and calls use opaque visit credentials. All responses have `{data,meta?}` envelopes and errors `{error:{code,message,details?},requestId}`.

## Public customer API
- `POST /public/t/:qrToken/sessions` -> 201 `{data:{sessionToken,expiresAt,firstCallNeedsConfirmation:true,availableCallTypes}}`. QR must be current/enabled; session token is a separate 256-bit bearer secret stored as hash server-side, with 4h idle timeout. Start cap 30 sessions per table per minute.
- `POST /public/sessions/heartbeat` body `{sessionToken}` -> 200 `{data:{expiresAt,firstCallNeedsConfirmation,availableCallTypes}}`. Heartbeat extends idle timeout for valid sessions; no background heartbeat when user is away.
- `POST /public/calls` body `{sessionToken,type:"waiter"|"hookah",idempotencyKey:UUIDv4,firstCallConfirmed?:true}` -> 200 `{data:{id,tableId,type,createdAt,deliveryState:"queued"|"no_staff",ownerAlerted}}`. On first accepted call, firstCallConfirmed:true is required. Each new tap creates one UUID and retries reuse it. Cooldown per table/type is 10 seconds across devices, not per browser.
- `GET /public/t/:qrToken` continues returning table/menu context, now with `callsAvailable:boolean` and `availableCallTypes:("waiter"|"hookah")[]`. General menu URLs still have NO service-call access.

Never persist QR or session bearer credentials in URLs beyond the originally scanned QR, server logs, analytics or broad listing APIs. QR photos can be copied; the server does not attest location or a real physical visitor.

## Owner REST
- `GET/POST /owner/branches/:branchId/employees`: POST `{username,displayName,initialPassword,department:"waiter"|"hookah"}` returns 201 employee info without password; maxEmployees is transactionally enforced restaurant-wide.
- `POST /owner/shifts/:id/force-end` closes only this restaurant's open shift.
- `GET/PATCH /owner/call-routing`: PATCH `{routingMode:"department"|"all"}`; default department. Branch override: `GET/PATCH /owner/branches/:branchId/call-routing` PATCH `{routingMode?:"department"|"all"|null,shiftMaxMinutes?:60..1440}`. null inherits restaurant setting. Default 720-minute shift.
- `GET /owner/calls?limit=20&cursor=`, `GET /owner/alerts?limit=20`, `POST /owner/alerts/:id/read` provide scoped history and persisted no-staff alerts.

## Employee Expo
- `POST /employee/shifts/start` 201; `POST /employee/shifts/end` 200; `GET /employee/shifts/current` returns `{data:Shift|null}` with `isOnShift` effective until plannedEndsAt or explicit end. Initial password change required.
- `GET /employee/calls?limit=20&cursor=` returns only calls assigned to the authenticated employee's branch/user. No accept/complete actions.

## Delivery integrity and frontend wording
`queued` means transaction saved call plus recipient rows and outbox pending records **for a future worker**; this is not device delivery. `no_staff` means call stored and owner-dashboard alert persisted, not an external SMS/WhatsApp/email. Do not show text saying employee received the request. Push, realtime, notification sounds, provider token registry, outbox worker and external owner channels remain unimplemented.

Errors: SESSION_EXPIRED 401; QR_REVOKED 404; FIRST_CALL_CONFIRMATION_REQUIRED 409; IDEMPOTENCY_KEY_REUSED 409; COOLDOWN_ACTIVE 429 with `details.retryAfterSeconds`; SESSION_RATE_LIMITED 429; PLAN_LIMIT_REACHED 403; SUBSCRIPTION_INACTIVE 403; PLAN_FEATURE_DISABLED 403; CALLS_DISABLED 403; SHIFT_ALREADY_ACTIVE 409. 401/403/404 honor tenant and role boundaries.

Integration status: Backend code is on PR #10; web, dashboard and Expo adapters/staging smoke tests have NOT been changed or verified.
