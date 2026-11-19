# ADR-004 — Authentication, refresh rotation and RBAC
Date: 2026-11-19. Status: Implemented for first auth slice, not full production security signoff.

## Choices
- Local username/password; **scrypt** (N=32768,r=8,p=1, 16-byte random salt, 64-byte key). No plaintext or fixed credentials in repository.
- JWT HS256 access token, 15 minutes, explicitly verified issuer, audience and session ID. Auth guard rechecks session and current user, restaurant and branch state from PostgreSQL on every request; role and scope are *not trusted from JWT claims*.
- Separate 30-day rotating refresh token (48 random bytes) stored only as SHA-256 digest in PostgreSQL. Successful refresh uses an atomic conditional UPDATE; all old refresh digests recorded for replay detection and session revocation. Logout and password change revoke active sessions.
- Browser: HttpOnly, SameSite=Strict, Secure in production cookie scoped to `/api/v1/auth`. Cookie refresh/logout requires Origin exactly in `CORS_ORIGINS`; browser deployment must be same-site. Mobile: refresh token returned only in `client=mobile` mode; store in Expo SecureStore, never in AsyncStorage or URL. Access token in memory.
- Required `AUTH_ACCESS_SECRET` >=32 UTF-8 bytes, injected by deployment env; generate randomly. Test-only CI secret must never be used in deployment.
- Role guard **denies routes without explicit policy**; `@Roles`, `@AllowAuthenticated`, `@Public`. On owner/employee endpoints use `@RestaurantScope` or `@BranchScope` and explicit owner/employee roles; roles alone do not grant tenant-scoped data access.
- Users with `must_change_password` cannot access business routes. Allowed to request `/auth/me`, `/auth/change-password`; change password audits action and invalidates all sessions.
- Login failure throttle is atomically persisted by normalized username hash, 5 failures / 15 min, basic cross-replica defense. Additional ingress IP throttling, password reset/recovery and operations monitoring are required before internet-facing deployment.
- Primary-admin provisioning is an explicit one-time `npm run auth:bootstrap:primary` command with env-supplied username/password, compiled password algorithm and advisory lock. No default admin is automatically created.

## Limits and pending production work
- Account lockout by username can be abused for denial-of-service; add edge rate limits on IP/device before public production.
- Cookie mode intentionally requires same-site trusted browser origins; deploy API and dashboards accordingly or approve a separate cross-site/CSRF strategy.
- Browser refresh token is not JS-readable. No cookie-based access token. Mobile refresh use depends on Expo secure storage and exact adapter contract.
- Subscription enforcement, plan feature gating, owner support impersonation and full authorization of future CRUD remain separate features.
- Backups, audit retention, session cleanup, secret rotation and end-to-end production security review remain operational release gates.
