# ADR-009 — Expo Push devices, durable worker and resumable SSE

Date: 2026-11-19. Status: Accepted for backend v1.9.

## Why a standalone worker?
The API only persists calls/outbox and realtime events in the same transaction; it never sends HTTP requests to Expo during a customer request. Push dispatch lives in a separate Dokploy process sharing PostgreSQL, allowing independent restarts, rate limiting and outbound network policy. A missing worker cannot prevent a call from being recorded. Worker is opt-in with PUSH_DISPATCH_ENABLED=true, API defaults to false.

## Device credentials and authorization
ExpoPushToken and ExponentPushToken formats are validated at the boundary; plaintext tokens are accepted only over TLS, encrypted at rest using AES-256-GCM and a separate persistent PUSH_TOKEN_ENCRYPTION_KEY. SHA-256 digest supports unique lookup, token is never returned in list/register responses or logged, and only employee-owned records are visible. At most five active devices per employee. To switch accounts on one device, unregister the token from the previous account first. Configured key must be the same for API and worker; rotating it without re-enrolling devices makes old ciphertext unreadable.

## Durable outbox mechanics
- Each call already persists a call_outbox recipient row. Worker expands to push_deliveries per active employee device using unique(outbox_id,device_id). An employee without a device remains pending for at most two minutes; inactive employee/branch, ended/auto-expired shift and nonoperational subscription suppress sending.
- Each device job is claimed by FOR UPDATE SKIP LOCKED and leased for 30 seconds. Max five attempts, exponential backoff for 429/5xx/network provider errors; no retry on permanent Expo ticket errors. Receipt polling runs at most once per minute for tickets. DeviceNotRegistered disables the device.
- A positive Expo send ticket sets push_deliveries.state=accepted and may set call_outbox.state=sent. This means **Expo accepted** the request only. Receipt "ok" means underlying APNs/FCM service accepted it, not that a user saw/heard a push. Failed/expired receipts and provider outages are separately tracked; client should deduplicate by callId, and customer message stays "تم تسجيل طلبك".
- Network ambiguity between Expo acceptance and DB persistence may cause duplicate handset pushes after process crash or timeout; exactly-once external delivery is impossible with this transport. Database call/idempotency remains exactly-once per key; worker is at-least-once. The push TTL is two minutes to avoid stale customer calls sounding much later.

## Realtime event consistency and security
- Every created call, no-staff owner alert and employee shift start/end emits a typed realtime_event within the same transaction as the domain write. Restaurant_event_counters row is locked to reserve contiguous per-restaurant sequences, ensuring commit order for resume cursors. No process-local fanout required.
- Owner stream sees only recipient_user_id NULL within restaurant; employee stream sees only recipient_user_id=authenticated user ID and matching branch. HTTP request requires bearer JWT/role, and every 2s polling iteration reauthenticates the access token and enforces subscription. Five-minute stream limit triggers reconnect. Server reads at most 100 events/tick, sends heartbeat when empty; Last-Event-ID or ?after=N resumes. UI client uses fetch-based SSE for Authorization headers; never put accessToken in URL. Old event retention requires scheduled cleanup in later operations slice; history endpoints remain durable source of truth.
- No raw credentials, QR tokens, visit tokens, employee passwords, Expo tokens or personal contact fields in event payloads. SSE includes only IDs, type, status and timestamps.

## Explicit remaining work
- Expo mobile app must register iOS/Android notification permissions, configure two native Android channels and distinct optional sound assets, handle foreground notifications and background push, and test physical iOS+Android. Backend cannot force OS sounds. Client must implement SSE fetch streaming reconnect/cursor and use call history as fallback.
- Deploy/test API and worker on Dokploy, verify outward connectivity to exp.host, device receipt statuses, restart/recovery and alert monitoring. Expo push security/enhanced access and FCM/APNs credentials need external setup.
- Full staging tests, backup/restore rehearsal, worker failure dashboard, event retention policy, traffic/load test and production monitoring are NOT completed. No real phone delivery has been verified by CI.
