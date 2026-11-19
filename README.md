# Restaurant Platform Backend

NestJS + PostgreSQL multi-tenant restaurant QR menu and staff-call platform.

## Repository status
Core database schema, Auth/RBAC, and platform-admin restaurant onboarding (create/list/detail/update) are implemented. Manual plan and subscription administration, owner status and renewal contacts are implemented in the subscriptions slice. Owner branch CRUD, per-branch category/product CRUD, public menu reads and independent menu copy are implemented, with transactional branch plan quota and menu feature checks. Floor/area/table CRUD, atomic table quotas, revocable encrypted table QR URLs and print-ready PDFs are implemented in v1.7. Visit sessions (4h idle), employee shifts, call routing, idempotent service calls, owner alerts and durable pending outbox are implemented in v1.8. Push/realtime delivery, client integration and image upload/transcoding remain future work. `openapi/restaurant.v1.yaml` is a draft that includes unimplemented operations; **generated** `/api/docs-json` reflects actually implemented endpoints.

## Start locally
1. Use Node 20 and PostgreSQL 17. `cp .env.example .env`, set local database credentials and generate a random `AUTH_ACCESS_SECRET` (at least 32 UTF-8 bytes): `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.
2. `docker compose -f docker-compose.dev.yml up -d` starts a local database.
3. `npm install`, `npm run db:migrate`, `npm run start:dev`. Migrations must run before startup.
4. `npm run build` then configure **temporary one-time** environment values `PRIMARY_ADMIN_USERNAME` and `PRIMARY_ADMIN_PASSWORD` (12+ characters), and run `npm run auth:bootstrap:primary`. Remove one-time credentials from environment immediately after. Provisioning refuses if a primary admin exists; password change is mandatory on first login.
5. Read `docs/AUTH_DASHBOARD_HANDOFF.md` for browser cookie and mobile SecureStore integration. Read `docs/VISITS_CALLS_WORKFORCE_HANDOFF.md` for the v1.8 API/client handoff. Read `docs/TABLES_QR_DASHBOARD_HANDOFF.md` for table/QR handoff and deployment configuration. Read `docs/BRANCH_MENU_DASHBOARD_HANDOFF.md` for owner dashboard/public catalog contracts. Read `docs/RESTAURANT_DASHBOARD_HANDOFF.md` for admin restaurant onboarding APIs; POST creates restaurant + owner + first branch with no active subscription.

## Quality gates
Run `npm run db:migrate:check`, `npm run check:architecture`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration` and `npm run build`. Integration tests require a dedicated migrated PostgreSQL database (do not point tests at production).

## API consumers
- `retuarant-dash`: two Vite apps in a workspace, `apps/admin` and `apps/restaurant`.
- `resturant-customer`: public QR frontend.
- `resturant-mobile`: Expo employee app.

## Production gates
Use Dokploy environment secrets, HTTPS reverse proxy, exact browser origin allowlist, PostgreSQL backups, and load balancer/IP rate limits. Session cleanup, secret rotation and full staging smoke tests are required before production. Never commit passwords, JWT secrets or production DB credentials.

See `docs/ADR-003-DATABASE-PERSISTENCE.md` and `docs/ADR-004-AUTH-SESSION-SECURITY.md` for boundaries.

## Dokploy staging database

Deploy PostgreSQL 17 on the private service network first. Configure the API runtime with its internal `DATABASE_URL`, a unique `AUTH_ACCESS_SECRET`, and the exact HTTPS dashboard origins in `CORS_ORIGINS`. Use the root Dockerfile and container port 3000. The container applies pending migrations before starting NestJS. Check the deployment logs and run `npm run db:migrate:check` inside the API container after startup.

To provision the first platform admin, run `npm run auth:bootstrap:primary` with the temporary credentials described above.

For a dedicated staging database, set `APP_ENV=staging` and provide temporary `DEMO_YASMIN_OWNER_PASSWORD` and `DEMO_WARD_OWNER_PASSWORD` values. Run `npm run db:seed:demo` inside the migrated API container, then remove the temporary passwords. The command creates the two fixture restaurants, three branches, and the owner accounts `demo.yasmin.owner` and `demo.ward.owner`. Owners must change their password on first login. Rerunning the command preserves existing seeded records and passwords. A conflicting slug or username on an unrelated record aborts the transaction. The web dashboard must use the live API to see these records.
