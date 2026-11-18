# Security, operations and deployment baseline
- Node LTS and pinned lockfile, NestJS strict validation, CORS allowlist, helmet, structured request IDs.
- Postgres migrations as deploy step; encrypted backups daily with tested restore and retention; no destructive auto-sync.
- Secret manager/Dokploy env; no committed .env; rotate credentials; health/live and health/ready.
- Rate limit public QR and call APIs; atomic idempotency/cooldown, abuse monitoring. QR sharing is possible; no GPS.
- Audit role changes, subscription activation, QR rotation, password reset, owner support access.
- Background push via provider adapter with retries, outbox, dead-letter; do not promise delivery.
- Metrics: request latency, errors, call-to-notification lag, no-staff alerts, queue depth, subscription status.
- Deployment: staging before production, smoke checks, rollback plan, separate worker if needed.
