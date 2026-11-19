# Restaurant Platform Backend

NestJS + PostgreSQL multi-tenant restaurant QR menu and staff-call platform.

## Repository status
Core database schema and Auth/RBAC vertical slice. Business CRUD, QR, calls, push, onboarding and subscription enforcement are future milestones. `openapi/restaurant.v1.yaml` is a draft that includes unimplemented operations; **generated** `/api/docs-json` reflects actually implemented endpoints.

## Start locally
1. Use Node 20 and PostgreSQL 17. `cp .env.example .env`, set local database credentials and generate a random `AUTH_ACCESS_SECRET` (at least 32 UTF-8 bytes): `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.
2. `docker compose -f docker-compose.dev.yml up -d` starts a local database.
3. `npm install`, `npm run db:migrate`, `npm run start:dev`. Migrations must run before startup.
4. `npm run build` then configure **temporary one-time** environment values `PRIMARY_ADMIN_USERNAME` and `PRIMARY_ADMIN_PASSWORD` (12+ characters), and run `npm run auth:bootstrap:primary`. Remove one-time credentials from environment immediately after. Provisioning refuses if a primary admin exists; password change is mandatory on first login.
5. Read `docs/AUTH_DASHBOARD_HANDOFF.md` for browser cookie and mobile SecureStore integration.

## Quality gates
Run `npm run check:architecture`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration` and `npm run build`. Integration tests require a dedicated migrated PostgreSQL database (do not point tests at production).

## API consumers
- `retuarant-dash`: two Vite apps in a workspace, `apps/admin` and `apps/restaurant`.
- `resturant-customer`: public QR frontend.
- `resturant-mobile`: Expo employee app.

## Production gates
Use Dokploy environment secrets, HTTPS reverse proxy, exact browser origin allowlist, PostgreSQL backups, and load balancer/IP rate limits. Session cleanup, secret rotation and full staging smoke tests are required before production. Never commit passwords, JWT secrets or production DB credentials.

See `docs/ADR-003-DATABASE-PERSISTENCE.md` and `docs/ADR-004-AUTH-SESSION-SECURITY.md` for boundaries.
