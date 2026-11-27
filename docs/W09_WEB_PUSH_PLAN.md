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
