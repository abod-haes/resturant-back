# Restaurant Platform Backend

NestJS + PostgreSQL multi-tenant restaurant QR menu and staff-call platform.

## Repository status
Core database schema, Auth/RBAC, primary-only platform administrator lifecycle, and platform-admin restaurant onboarding (create/list/detail/update) are implemented. Manual plan and subscription administration, owner status and renewal contacts are implemented in the subscriptions slice. Owner branch CRUD, per-branch category/product CRUD, public menu reads and independent menu copy are implemented, with transactional branch plan quota and menu feature checks. Floor/area/table CRUD, atomic table quotas, revocable encrypted table QR URLs and print-ready PDFs are implemented in v1.7. Visit sessions, employee accounts/shifts, durable call recording, cooldown/idempotency, shift-aware outbox routing and no-staff owner alerts are implemented in v1.8. Employee Expo device registry, opt-in durable Expo push worker with retry/tickets/receipts, and owner/employee resumable SSE are implemented in v1.9. Actual phone delivery/sounds, frontend integrations and external owner notification are NOT verified; managed WebP/image uploads and private PDF files are implemented in v1.11; live storage setup remains future deployment work. v1.10 adds gated UTC owner call analytics and primary-only redacted audit browsing. v1.12 adds primary-only platform administrator management with forced password changes, audited updates and session revocation. `openapi/restaurant.v1.yaml` tracks all 96 currently implemented HTTP operations (CI-verified path/method parity), but some response descriptions lack full static schemas; **generated** `/api/docs-json` reflects actual controller DTO definitions and must be used for frontend type generation.

## Start locally
1. Use Node 20 and PostgreSQL 17. `cp .env.example .env`, set local database credentials and generate a random `AUTH_ACCESS_SECRET` (at least 32 UTF-8 bytes): `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.
2. `docker compose -f docker-compose.dev.yml up -d` starts a local database.
3. `npm install`, `npm run db:migrate`, `npm run start:dev`. Migrations must run before startup.
4. `npm run build` then configure **temporary one-time** environment values `PRIMARY_ADMIN_USERNAME` and `PRIMARY_ADMIN_PASSWORD` (12+ characters), and run `npm run auth:bootstrap:primary`. Remove one-time credentials from environment immediately after. Provisioning refuses if a primary admin exists; password change is mandatory on first login.
5. Read `docs/PLATFORM_ADMINS_DASHBOARD_HANDOFF.md` for primary-only platform administrator management. Read `docs/PUSH_REALTIME_HANDOFF.md` to configure a separate Dokploy push worker, mobile device registration and authenticated SSE. Read `docs/AUTH_DASHBOARD_HANDOFF.md` for browser cookie and mobile SecureStore integration. Read `docs/ANALYTICS_AUDIT_HANDOFF.md` for the analytics/audit dashboard API; read `docs/VISITS_CALLS_HANDOFF.md` for customer, owner and employee call flows. Read `docs/TABLES_QR_DASHBOARD_HANDOFF.md` for table/QR handoff and deployment configuration. Read `docs/BRANCH_MENU_DASHBOARD_HANDOFF.md` for owner dashboard/public catalog contracts. Read `docs/RESTAURANT_DASHBOARD_HANDOFF.md` for admin restaurant onboarding APIs; POST creates restaurant + owner + first branch with no active subscription.

## Quality gates
Run `npm run db:migrate:check`, `npm run check:architecture`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e` and `npm run build`. Integration tests require a dedicated migrated PostgreSQL database (do not point tests at production).

## API consumers
- `retuarant-dash`: two Vite apps in a workspace, `apps/admin` and `apps/restaurant`.
- `resturant-customer`: public QR frontend.
- `resturant-mobile`: Expo employee app.

## CORS deployment option

Set `CORS_ORIGINS=*` to accept requests from any browser Origin, including localhost. Because browser credentialed requests cannot use a literal `Access-Control-Allow-Origin: *`, the HTTP CORS middleware reflects the requesting Origin and sends `Access-Control-Allow-Credentials: true`. This is broad cross-origin access: only use it when intentionally accepting requests from arbitrary websites. CORS is not authentication, authorization, or CSRF protection; existing refresh/logout trusted-Origin checks remain separate and may still reject origins not explicitly trusted. A fixed list of exact HTTPS origins is preferred in production.

## Push worker (v1.9)

Device registration requires `PUSH_TOKEN_ENCRYPTION_KEY` in the API environment. Run a second, independent Dokploy service using the same build image with command `npm run push:worker`, set `PUSH_DISPATCH_ENABLED=true`, the same `DATABASE_URL`, `AUTH_ACCESS_SECRET`, and `PUSH_TOKEN_ENCRYPTION_KEY`, plus `EXPO_PUSH_ACCESS_TOKEN` if required by Expo project settings. API replicas should keep PUSH_DISPATCH_ENABLED=false. Worker is not started from the API's HTTP process. SSE endpoints `/api/v1/owner/events` and `/api/v1/employee/events` require bearer headers and support Last-Event-ID resume; dashboard/mobile adapters are pending.

## Production gates
Use Dokploy environment secrets, HTTPS reverse proxy, exact browser origin allowlist, PostgreSQL backups, and load balancer/IP rate limits. Session cleanup, secret rotation and full staging smoke tests are required before production. Never commit passwords, JWT secrets or production DB credentials.

See `docs/ADR-003-DATABASE-PERSISTENCE.md` and `docs/ADR-004-AUTH-SESSION-SECURITY.md` for boundaries.

## Dokploy staging database

Deploy PostgreSQL 17 on the private service network first. Configure the API runtime with its internal `DATABASE_URL`, a unique `AUTH_ACCESS_SECRET`, and the exact HTTPS dashboard origins in `CORS_ORIGINS`. Use the root Dockerfile and container port 3000. The container applies pending migrations before starting NestJS. Check the deployment logs and run `npm run db:migrate:check` inside the API container after startup.

To provision the first platform admin, run `npm run auth:bootstrap:primary` with the temporary credentials described above.

For a dedicated staging database, set `APP_ENV=staging` and provide temporary `DEMO_YASMIN_OWNER_PASSWORD` and `DEMO_WARD_OWNER_PASSWORD` values. Run `npm run db:seed:demo` inside the migrated API container, then remove the temporary passwords. The command creates the two fixture restaurants, three branches, and the owner accounts `demo.yasmin.owner` and `demo.ward.owner`. Owners must change their password on first login. Rerunning the command preserves existing seeded records and passwords. A conflicting slug or username on an unrelated record aborts the transaction. The web dashboard must use the live API to see these records.

## S3 media storage — v1.11
Set `MEDIA_S3_BUCKET`, `MEDIA_S3_REGION`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY`, `MEDIA_PUBLIC_ORIGIN` in Dokploy. Optional `MEDIA_S3_ENDPOINT` and `MEDIA_S3_FORCE_PATH_STYLE`. Keep bucket private, expose only image .webp paths through an HTTPS CDN, never PDFs. `npm run media:cleanup` is a separate bounded optional scheduled job, not an API worker. See `docs/MEDIA_DASHBOARD_HANDOFF.md`.

## Restaurant journey acceptance check
The CI job runs `npm run test:e2e` with a disposable PostgreSQL database ending in `_test`. It verifies the joined HTTP/DB flow from restaurant onboarding through published menu, table QR, no-staff alert, on-shift employee queue/push ticket simulation, cross-tenant isolation, QR revocation and expired subscription handling. Expo gateway is mocked; real handset delivery, reverse-proxy SSE, S3/CDN and client-app integration still need deployed staging/device tests. See `docs/TEST_STRATEGY.md`.

## Executable Swagger
Open `/api/docs` for the interactive docs or `/api/docs-json` for controller-generated OpenAPI. The backend CI asserts one-to-one parity of runtime and versioned YAML path+method inventories and documents the standard JSON error envelope. See `docs/EXECUTABLE_SWAGGER.md`.

## Complete API handoff and downloadable generated contract

- [All 96 endpoints: grouped frontend contract catalogue](docs/ALL_96_API_CONTRACT_FRONTEND.md).
- Static reference: `openapi/restaurant.v1.yaml` (route inventory, sample requests and selected response schemas).
- **Machine-generated actual DTO contract:** run `npm run build && npm run contract:export` with validated backend environment variables. Output: `artifacts/restaurant.openapi.json`. GitHub Actions additionally uploads this exact file as `restaurant-openapi-runtime` on successful quality runs; use that for OpenAPI type generation.
- Running backend itself serves `/api/docs` (Swagger UI) and `/api/docs-json` (exact full schema). Generated runtime JSON is authoritative if a static description-only response lacks details. Do not place secrets in the exported JSON.
