# ADR-008 — QR visit sessions, call idempotency and shift-aware routing

Date: 2026-11-19. Status: Accepted backend v1.8 slice.

## Invariants
- A new anonymous visit starts from a current QR credential only; server creates a cryptographically random 32-byte base64url session token, persists SHA-256 digest (never plaintext), binds to credential ID/version, table, branch and restaurant. Each authenticated request to a visit rechecks the table hierarchy, credential version and operational subscription. Rotation/revocation/disable makes old sessions unusable immediately. Four hours is **idle** TTL; a valid status read or successful newly recorded call slides expiry forward. Invalid/expired visits never revive. A table limits concurrent active sessions to 200 to constrain abuse.
- First successfully recorded call per visit must explicitly receive `confirmFirstCall:true`; afterward calls do not need confirmation. A failed attempt never flips the flag.
- Server enforces a 10-second global cooldown **per physical table and call type**, not per session/client. Calls lock the table database row FOR UPDATE before checking last call, making concurrent callers safe across replicas. Duplicate session+UUID idempotency key returns the original call even during cooldown; reuse for another type is 409.
- Plan and table/branch call-enabled flags checked for waiter/hookah separately. Restaurant defaults enabled=true, waiter=true, hookah=false and all_on_shift. Branch nullable overrides merge with root. Shift auto-end defaults 720 minutes and can be configured 60–1440; expired shifts don't route even before their DB row is finalized.
- Employees belong to one restaurant and one branch, with waiter/hookah department. Employee creation takes restaurant FOR UPDATE and enforces maxEmployees among nonarchived accounts; disabling never frees quota, archiving revokes auth and shift while retaining historical FK references. Owner reset of initial password revokes sessions and forces change.
- Every call and its intended recipients are written atomically to service_calls/call_outbox; if none on shift, record owner_alerts and state=no_staff. Outbox rows begin in state=pending, **no network adapter consumes them yet**. Queued is a persisted intent, never proof of push delivery. The ownerAlerted field means a database dashboard alert exists, not that an external alert was sent.

## Deliberate omissions
- No push token registry, Expo push, realtime, external owner-channel notification, alert delivery confirmation, or accept/complete lifecycle in v1.8. Future worker needs idempotent delivery, retry/backoff, dead-letter, device invalidation, and an independent deployment process.
- Anonymous QR is a bearer capability and can be shared; no physical-presence validation, GPS or checkout.
- UI must use honest customer copy, e.g. "تم تسجيل طلبك" rather than "استلم الموظف الطلب".
- No exhaustive background deletion/cleanup worker for expired visit sessions or open historical shifts yet; queries enforce expiry. Production maintenance and backup procedures must be specified before deployment.
- Any frontend integration not yet tested in staging is BLOCKED, not a production claim.

## Technical notes
- SQL foreign keys and unique constraints preserve tenant/branch integrity. Historical records survive archiving. Call/list pagination is bounded by 20 default/100 max.
- No secret env vars added; existing QR key+customer URL required for QR issuance. Session token never appears in query URLs or broad listings. Public calls POST only with Cache-Control:no-store.
