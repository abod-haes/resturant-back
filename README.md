# Restaurant Platform Backend

NestJS + PostgreSQL multi-tenant restaurant QR menu and staff-call platform.

## Repository status
Phase 0 foundation and core relational schema under active development. No real authentication, tenant CRUD, QR calls, outbox or push delivery are implemented yet. The versioned YAML under `openapi/` is a **draft**; generated Swagger currently reflects only implemented controllers.

## Start locally
1. Use Node.js 20 and a local PostgreSQL 17 instance.
2. `cp .env.example .env` and replace the example credentials for your local environment.
3. `docker compose -f docker-compose.dev.yml up -d` starts local Postgres with example credentials; these credentials must never be used in production.
4. `npm install` and `npm run db:migrate` to initialize the schema. Run `npm run db:migrate:check` to validate checksums/state.
5. `npm run start:dev` starts the API. Environment is loaded from `.env` via Nest ConfigModule; migration CLI uses dotenv.
6. `GET /api/v1/health/live` reports process liveness; `GET /api/v1/health/ready` reports live PostgreSQL readiness (503 on failure).

## Quality gates
`npm run check:architecture`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration` (requires test PostgreSQL **with migrations applied**), and `npm run build`.

## API consumers
- `retuarant-dash`: monorepo with separate `apps/admin` and `apps/restaurant` Vite apps sharing packages.
- `resturant-customer`: standalone customer QR frontend.
- `resturant-mobile`: Expo employee app.

## Production
Run migrations with the deployment `DATABASE_URL` before deploying the API, after confirming backups. Never run destructive schema synchronization or check production credentials into Git. Production seed creation and auth remain future features.

See `docs/ADR-003-DATABASE-PERSISTENCE.md`, `docs/PRD.md` and `docs/PARALLEL_DEVELOPMENT.md` for architecture and contract ownership.
