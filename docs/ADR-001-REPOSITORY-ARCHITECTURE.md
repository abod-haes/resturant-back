# ADR-001 — repository boundaries
Date: 2026-11-18. Updated: 2026-11-19. Status: Approved.

## Decisions
- `resturant-back` is the NestJS + PostgreSQL API; authoritative source of API contracts and access policies.
- `retuarant-dash` is a **monorepo with two separate React + Vite apps**, `apps/admin` (platform) and `apps/restaurant` (owner), plus shared workspace packages for UI, API, and configuration. They have independent routes, role scopes and deployment targets. They are **not** one app with conditional pages.
- `resturant-customer` is the separate React + Vite public menu / table QR client.
- `resturant-mobile` is the React Native + Expo employee app.
- `resturant-dash-admin` is legacy/reference; do not delete automatically.
- No Next.js in approved V1 architecture. Mock data schemas align through versioned API contracts; live app states are not coupled through mocks.

This entry supersedes the original one-dashboard-app wording. Update downstream documentation before integration; do not mutate other repositories from backend tasks.
