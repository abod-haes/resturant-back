# W09 — shared push registry (user decision 2026-11-27)
Reuse employee_push_devices, push_deliveries, call_outbox and service_calls. No new notification tables. Extend registry with channel, web platform, session ownership and expiry; reuse encrypted token_box and token_hash (channel-separated hash for web). Existing Expo rows default to expo. Extend delivery channel; preserve unique outbox/device and shared expansion. Expo registry/list/DTO must filter expo and preserve native contracts; worker dispatch branches by channel, Expo receipts only for Expo, web accepted is provider acceptance only. Web endpoint allowlist, no redirects, encryption, rate limits, session revocation, expiry, shift/tenant/entitlement checks, 404/410 cleanup and bounded retries required. B03 schema proposal updated; B04 onward and tests pending. Do not merge until compatibility changes are implemented.


## B08 — Notification reconciliation contract

- Web payload: eventType = call.created, callId, tag = call-{callId}, title, body, type (waiter or hookah).
- Provider topic: first 32 base64url characters of SHA-256(callId). Provider coalescing is best-effort, not exactly-once delivery.
- Service worker must validate payload, use the stable notification tag, and open/focus the same-origin /calls route on click.
- Notify open clients to invalidate the authenticated employee calls query. Do not insert unverified push payloads into call history.
- GET /employee/calls remains authoritative; reconcile on push, focus, reconnect and notification click, deduplicate by call ID, and scope query state to current employee/branch.
- Never put credentials or session tokens in notification payloads or URLs. Clear employee query state on session change.
- Existing unique (outbox_id,device_id) prevents duplicate delivery records. Multiple devices are intentionally supported.
- Retry scheduling is bounded by the existing 120-second call age and five attempts. Web acceptance is not a delivery receipt.
- Source changes saved; runtime tests, migration execution and device acceptance remain pending user verification.


## B10 — Frontend handoff (source implementation, runtime acceptance pending)

API prefix: /api/v1. Employee bearer authentication required.
- GET /employee/web-push/config -> {data:{enabled:boolean,publicKey:string|null}}.
- POST /employee/web-push/subscriptions -> send endpoint, expirationTime (Unix milliseconds or null), keys {p256dh,auth}; response {data:{id,isActive}}.
- DELETE /employee/web-push/subscriptions/{id} -> {data:{unregistered:true}}; current session scoped and idempotent.
- Request notification permission only after an explicit user gesture. Check secure context, service worker, PushManager and installed mode on iOS.
- Register or reconcile the browser subscription for the current authenticated employee; handle ownership conflicts by explicitly replacing the browser subscription. Never store raw subscription keys in localStorage.
- On logout, attempt unregister and browser unsubscribe; server session revocation independently deactivates web devices.
- Use callId and tag for notification deduplication; invalidate calls query on push and reconcile via GET /employee/calls.
- Keep native Expo behavior and existing database tables. Do not enable Web Push in production until migration and runtime acceptance.

Pending acceptance: install pinned dependencies, verify provider redirect behavior, typecheck, build, contract check, migration on isolated database, session revocation and concurrency tests, Expo regression, real Android/iOS PWA push tests. Review auth-session deletion/retention compatibility with restrictive FK. Feature branch must incorporate current main before merge. No production deployment or migration has been performed.

## Source audit — 2026-11-27

- Compared main and the feature branch in both directions before the gateway privacy update: feature 49 ahead / 5 behind. Main-only changes affect subdomain.ts, auth.service.ts, auth.types.ts and auth.dto.ts; no overlapping changed paths were reported. Auth/session behavior still requires integration review after synchronization.
- Reviewed channel filtering in registry, dispatch eligibility, session revocation trigger, bounded retries and Expo-only receipt handling. This is source inspection, not runtime regression evidence.
- Web Push provider payload now uses a generic body without table details (d05ac6b). Authenticated calls API remains authoritative.
- Main synchronization, migration/retention compatibility, contract validation, build and device acceptance remain pending. No merge or deployment performed.

## Final source inventory update — 2026-11-27
- Contract bounds and success literals documented in 6e84b26; DTO validation and Swagger metadata updated in 1443820. Generated contract and runtime validation remain unverified.
- Migration fe5bef9 adds a BEFORE DELETE trigger to deactivate and detach web devices when an auth session is removed while preserving delivery rows; active web devices still require a session. PostgreSQL migration and deletion/concurrency acceptance remain pending.
- Comparison at fe5bef9: 54 feature commits ahead, 5 main commits behind. Main synchronization remains a release blocker. No merge, deployment or database execution performed.

## Integration inventory — 2026-11-27
Main incorporated by ec8c759; branch was 60 ahead / 0 behind at verification. Auth response schemas documented in 670655a. Recipient scope and employee history labels fixed in 48a4f8f; dispatcher honors persisted recipients in 4cc7955; subscription operational display in c8812ea; registry forced-password recheck in a48cdda. Source readback only; contract generation, runtime, migration, lockfiles and physical device acceptance remain pending. No production merge or deployment.
