# Contract changelog

## v1.3.0 — 2026-11-19 (Auth vertical slice)
Implemented login/refresh/logout/me/change-password; runtime DTO validation, per-user throttling, short-lived JWT, rotating refresh (cookie web / body mobile), forced initial password change and deny-by-default role/branch scopes. `client` is optional default `web` and user includes `mustChangePassword`. Password change revokes all sessions and requires new login. Existing public QR and other draft endpoints remain **unimplemented**. Generated Swagger in Nest is the executable truth for the implemented slice; YAML contains drafts for unimplemented endpoints.
Consumer handoff: `docs/AUTH_DASHBOARD_HANDOFF.md`. Do not claim integrated until staging smoke tests pass.

## v1.2.0 — 2026-11-18
Added implementation-level request/response conventions, cursor pagination default 20/max 100, DTO inventory, explicit 429 retryAfterSeconds, role matrix and modular architecture. Draft until generated OpenAPI and contract tests validate implementation. Clients must use consistent DTOs.
## v1.1.0
Normalized fixtures and stateful mock engine across consumers, without runtime synchronization.
## v1.0.0-draft
Initial endpoint inventory.
