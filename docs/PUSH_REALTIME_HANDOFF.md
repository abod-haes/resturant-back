# Expo Push & Realtime v1.9 — Frontend + Dokploy handoff

Base `/api/v1`. Generated executable Swagger `/api/docs-json`. New paths are **backend implemented**, consumer apps are not modified by this PR.

## Expo employee application
After secure login (Bearer EMPLOYEE + mandatory password change), request OS notification permission. Obtain `ExpoPushToken` using the app's correct EAS project ID, then:
- POST `/employee/devices` `{"expoPushToken":"ExpoPushToken[...]","platform":"android"}` -> 201 `{"data":{"id":"uuid","platform":"android","isActive":true,"lastSeenAt":"UTC ISO","createdAt":"UTC ISO"}}`
- GET `/employee/devices` -> only own active devices, never tokens. DELETE `/employee/devices/:id` -> `{"data":{"unregistered":true}}`. Unregister on user/account change and update registration after token refresh; a token cannot remain active on two employee accounts.
- Register native Android channels `waiter_calls` and `hookah_calls` with distinct sounds in the Expo app before notifications arrive, and configure iOS sounds/bundled assets. The backend only sets channelId and sound default. FCM and APNs credentials must be configured via EAS. Foreground notification presentation must be explicitly implemented in Expo. Nothing in the backend guarantees an audible sound.
- `GET /employee/events?after=0` SSE with `Authorization: Bearer <access JWT>` header. Events `call.created` (recipient-specific) and `shift.updated`; event `id` is a restaurant-scoped cursor. Use fetch ReadableStream/EventSource polyfill supporting Authorization headers; native EventSource URL tokens are prohibited. Resume via `Last-Event-ID: <last sequence>` after refresh/reconnect, suppress duplicate eventIds locally. Connection terminates after up to 5m; validate reconnect and 401/403 paths.
- `GET /employee/calls` is the canonical source of truth after reconnect, offline, permission denial or push delivery failure. No accept/complete buttons in V1.

## Restaurant owner dashboard
- `GET /owner/events?after=0` Bearer owner SSE. Event types call.created, owner.alert.created, shift.updated. Each event: `id: "<sequence>"`, `event: "call.created"`, `data:{eventId,eventType,occurredAt,branchId,payload}`. Heartbeats have no id. Owner gets tenant-wide events; employees receive only own assigned branch events. No secrets in payload.
- Maintain local last sequence and reconnect with bearer refresh (JWT expires after 15m). Avoid running more than one live feed per tab. Refresh `/owner/calls` and `/owner/alerts` paginated queries when corresponding events arrive; do not treat SSE as full list. Handle disconnections, invalid cursor, expired subscription.
- Never display "وصل الموظف" just because call_outbox says sent. Customer still sees "تم تسجيل طلبك" only.

## Dokploy API and push worker
1. Apply new forward migrations via existing API container entry command, run `npm run db:migrate:check`.
2. API secrets: existing `DATABASE_URL`, `AUTH_ACCESS_SECRET`, `QR_TOKEN_ENCRYPTION_KEY`, `CUSTOMER_APP_ORIGIN`. Add new random 32-byte hex `PUSH_TOKEN_ENCRYPTION_KEY` persisted in Dokploy. Generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep `PUSH_DISPATCH_ENABLED=false` on API (default).
3. Create a separate Dokploy **worker service** from the same image/repository and database. Override run command to `npm run push:worker` (image already contains dist from `npm run build`). Set identical DATABASE_URL, AUTH_ACCESS_SECRET and PUSH_TOKEN_ENCRYPTION_KEY, plus PUSH_DISPATCH_ENABLED=true. Configure EXPO_PUSH_ACCESS_TOKEN if Enhanced Push Security is on. Ensure API migrations finished before starting worker. No public port is needed for the worker. Do not duplicate the same key into QR variable.
4. Worker claims up to 15 jobs per loop and polls receipts. Expo HTTP ticket accepted is not handset receipt; persisted state tracks `pending|accepted|failed` and receipt `waiting|ok|error|expired`. Never log token or provider body. Verify worker crashes/restarts without losing database jobs.
5. Do **not** promote to production until physical Android/iOS test validates permissions, Expo project ID, notification channel/sounds, foreground/background behavior, token churn, DB receipt statuses, network egress and owner SSE behind the actual reverse proxy (`X-Accel-Buffering: no`).

## Versioned errors
- POST device: 400 invalid format, 401 missing auth, 403 role or inactive subscription, 409 DEVICE_ALREADY_REGISTERED/DEVICE_LIMIT_REACHED, 503 PUSH_NOT_CONFIGURED.
- SSE: 401 missing/expired bearer, 403 other role or subscription inactive; re-connect with a fresh JWT, never expose it in URL.

No front/mobile repo was changed and no external device received a real push in CI. Contract adapter integration is BLOCKED until independent staging smoke tests.
