# Phase 0 implementation status — 2026-11-19

## Merged
- PR #1: typed runtime config, safe error envelope, PostgreSQL readiness and CI.
- PR #2: Kysely typed schema, transactional SQL migrations with checksums, PostgreSQL relational tenant constraints.

## Auth v1.3.0 in progress (subject to CI)
- POST auth login/refresh/logout/change-password and GET auth/me.
- JWT + DB active-session verification, rotating opaque hashed refresh, replay revocation, web cookies/mobile body, forced password change, audit record.
- Deny-by-default roles and resource scope decorators, no default platform support impersonation.
- Deterministic isolated integration tests incl. cross-branch, replay, expired/invalid tokens and missing route policy.

## Not complete
- Platform-admin management, restaurant onboarding CRUD, subscription enforcement, employee shifts and operational calls.
- Production edge rate limits, secret lifecycle, backup and restore drills, comprehensive app staging handshake and mock/live adapter updates.
- Pinned dependency lockfile and proven container deploy.
