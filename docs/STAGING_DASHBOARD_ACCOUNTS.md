# Staging dashboard account provisioning (real backend)

**Never use a mock/guest login for the dashboards.** These commands write real PostgreSQL users and are intended for a dedicated staging database. Check that `DATABASE_URL` points at the correct environment before running.

## 1. Migrate and compile

Run in the backend runtime/container with the real database configuration:

```sh
npm run db:migrate
npm run build
```

## 2. Create the first platform admin (only if none exists)

Generate a unique strong password in your secret manager; temporarily set:

```sh
export PRIMARY_ADMIN_USERNAME=platform.admin
export PRIMARY_ADMIN_PASSWORD='<your-unique-random-password-of-at-least-12-characters>'
npm run auth:bootstrap:primary
unset PRIMARY_ADMIN_USERNAME PRIMARY_ADMIN_PASSWORD
```

This command is intentionally one-time; it refuses to overwrite an existing PRIMARY_ADMIN. If one already exists, use the approved password-reset flow instead of rerunning bootstrap.

## 3. Create real restaurant-owner test accounts (staging only)

The existing idempotent seed `scripts/seed-demo.mjs` reads `mocks/fixtures.json` and creates two restaurants, three branches and these credentials:

| Role | Username | Restaurant |
| --- | --- | --- |
| RESTAURANT_OWNER | `demo.yasmin.owner` | مطعم الياسمين |
| RESTAURANT_OWNER | `demo.ward.owner` | مطعم الورد |

Set unique passwords at runtime, never in Git:

```sh
export APP_ENV=staging
export DEMO_YASMIN_OWNER_PASSWORD='<unique-password-min-12-characters>'
export DEMO_WARD_OWNER_PASSWORD='<different-password-min-12-characters>'
npm run db:seed:demo
unset DEMO_YASMIN_OWNER_PASSWORD DEMO_WARD_OWNER_PASSWORD
```

The seed uses `ON CONFLICT ... DO NOTHING` for existing IDs: reruns do not rotate credentials. Both owners have `must_change_password=true` and must change their password at first login. It seeds only restaurants, branches and owners, **not** menu products, plans or subscriptions. Add any additional data through authenticated API or a separately reviewed seed, not production fixtures.

## 4. Test through live API

Use POST `/api/v1/auth/login` with `{ "username": "...", "password": "...", "client": "web" }`, then check GET `/api/v1/auth/me` and first-login password-change requirements. The frontend needs `VITE_API_MODE=live`, a reachable `VITE_API_BASE_URL`, CORS and trusted web origins.

No account is created simply by deploying the frontend or committing this file. The commands must run successfully against the intended PostgreSQL instance.
