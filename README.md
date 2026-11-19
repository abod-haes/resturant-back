# Restaurant Platform Backend

NestJS + PostgreSQL multi-tenant restaurant QR menu and staff-call platform.

## Repository status
**Phase 0 foundation in progress**. No real auth, migrations, tenant CRUD, QR calls, outbox or push delivery are implemented yet. The versioned YAML under `openapi/` is a **draft**; generated Swagger currently reflects only implemented controllers.

## Start locally
1. Use Node.js 20 and a local PostgreSQL 17 instance.
2. `cp .env.example .env` and replace the example credentials for your local environment.
3. `docker compose -f docker-compose.dev.yml up -d` starts local Postgres with the example credentials; these credentials must never be used in production.
4. `npm install`, then `npm run start:dev`. Environment variables are loaded from `.env` via Nest's ConfigModule (or injected by the deployment environment).
5. Liveness: `GET /api/v1/health/live`. Readiness: `GET /api/v1/health/ready` returns 200 only when PostgreSQL is reachable; otherwise 503.

## Quality gates
Run `npm run check:architecture`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration` (requires test Postgres), and `npm run build`. No test script uses `--passWithNoTests`.

## API consumers
- `retuarant-dash`: monorepo with separate `apps/admin` and `apps/restaurant` Vite apps sharing packages.
- `resturant-customer`: standalone customer QR frontend.
- `resturant-mobile`: Expo employee app.

See `docs/PRD.md`, `docs/ADR-001-REPOSITORY-ARCHITECTURE.md`, `docs/ADR-002-FOUNDATION.md` and `docs/PARALLEL_DEVELOPMENT.md` before implementing features. Changes to public contracts must be versioned and communicated across all consumers.
