# ADR-008 — QR visits, service-call consistency and truthful delivery
Date: 2026-11-19. Status: Accepted for v1.8 implementation.

## Visit lifecycle
Anonymous QR opens a 256-bit opaque visit capability, persisted only as SHA-256. Session idle lifetime is four hours; authenticated heartbeat or accepted new call extends expiry. Expired sessions cannot be revived; QR rotation or disabled table/floor/area/branch invalidates sessions on subsequent access. Admission throttles 30 sessions per table per minute. Static QR is not physical presence proof; add edge protections and abuse monitoring for production.

## Atomic calls
Public calls require independent session token, requested waiter/hookah feature, live QR version, table call switch and operational subscription. First accepted call requires firstCallConfirmed:true (UX intent, not proof that modal was displayed). Request UUIDv4 is unique per session; an exact retry returns the same receipt, reuse for another type returns 409. PostgreSQL row lock on the table serializes calls from different sessions and API replicas. A 10-second cooldown applies per table and department. No employee accept/complete workflow.

## Workforce and routing
Owner creates employees with password-change requirement and maxEmployees quota. Employees self-start/end shifts; owner may force-end. Planned end from branch configured 60–1440 minutes, default 720, is checked at call-routing time without background timers. Routing mode is restaurant default ("department") or branch override ("all" or "department"); only active, password-changed, same-branch, on-shift employees are targeted.

## Honest notification status
`queued` means recipients and pending outbox are persisted, NOT pushed or delivered; `no_staff` means owner-dashboard alert persisted, NOT delivered to an external channel. Future worker must claim/retry/mark outbox records with worker ownership, idempotent push/realtime and dead-letter metrics, and handle stale device tokens. Do not switch customer UX to "received by employee" without verified delivery. No push worker, websocket, device registration or external owner notification in this backend slice.

## Security and release
No secrets, raw session credentials, body tokens or client-supplied tenant IDs in logs/outbox. PostgreSQL composite tenant/branch FKs and access policies govern all reads/writes. Additive forward migration, backup and production rate-limit review required. Client contract handoff, staging tests, actual push delivery and QR onsite checks are separate release gates.
