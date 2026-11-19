# ADR-007 — Table QR issuance, tenant quota, rotation and PDF print

Date: 2026-11-19. Status: Accepted for v1.7.0.

## Data boundaries
Floors belong to one branch. Areas belong to one floor and branch. Tables belong to one area and branch. Composite PostgreSQL foreign keys protect against cross-branch moves even if a handler is bypassed. Tenant scope is derived from the JWT principal and checked in each read/write. Platform admins have no implicit owner impersonation.

Each table has a human label, sortOrder, enabled flags and a stable UUID. Renaming or moving a table changes only metadata; never changes the QR token. Soft-archived tables keep database history, revoke active QR and free quota. Disabled tables still count toward the plan's maxTables.

## QR security model
One active credential per table, enforced with a PostgreSQL partial unique index. Tokens are generated from 32 random bytes and encoded using base64url; public lookup is SHA-256(token). Store no plaintext token, only its hash and AES-256-GCM authenticated encryption envelope for authorized owner reprinting. Store encrypted token under QR_TOKEN_ENCRYPTION_KEY, a persistent 32-byte secret represented by 64 hex characters in Dokploy. Back up key securely; key loss makes existing QR printing impossible without rotating (existing publicly printed links still resolve by hash). Treat QR links as bearer capabilities, not physical location proofs; scanning a shared photo may work. Do not log tokens.

Rotation revokes the previously active token and replaces it in the same transaction, increments version and leaves qrEnabled unchanged. Public read rejects old, disabled, archived or wrong-version QR without returning the tenant's internal data. Future sessions must validate credential version/active state per request; **no session records exist in this slice**, so session revocation has not been demonstrated.

## Quotas and concurrency
All bulk/table creates lock the restaurant row FOR UPDATE, calculate count of nonarchived tables across all restaurant branches, and insert new tables plus their QR credentials in the same transaction. Count includes inactive tables; permanent archive frees slot. Maximum 50 tables per bulk request and up to 100 per PDF.

## Printing
PDF generation uses pdf-lib and qrcode for A4 sticker sheets, 2 columns × 3 rows. QR embeds the customer URL `CUSTOMER_APP_ORIGIN/t/<token>`, where origin must be HTTPS. Returned PDF is owner-only and no-store. Built-in Helvetica only supports ASCII, so Arabic labels fall back to the first 8 characters of a table UUID while QR remains correct. Arabic text rendering requires an approved Unicode-font embedding and RTL shaping follow-up.

## Contract separation
`GET /public/t/:qrToken` only validates QR and reports restaurant/branch/table plus a menu API path and `callsAvailable:false`. It does not create session tokens or queue employee notifications. Four-hour visit sessions, idempotency and 10-second per-type cooldown belong to v1.8; no false success is shown to customers in v1.7.

## Deployment and rollback
Migration is additive, intended forward-only, must be executed before enabling endpoints. Key and URL are optional at application startup but mandatory for QR create, rotate and print. Never default to a checked-in encryption key. Keep a backup before migration, and verify public link behavior and QR PDF visually in staging before production. Client app and live staging handshake are not verified in this backend PR.
