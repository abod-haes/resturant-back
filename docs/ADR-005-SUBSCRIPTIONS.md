# ADR-005 — Manual plans and subscription lifecycle
Date: 2026-11-19. Status: Accepted for backend v1.5 slice.

## Approved semantics implemented
- Platform PRIMARY_ADMIN and PLATFORM_ADMIN maintain plans. Feature registry is limited to `menu`, `waiter_calls`, `hookah_calls`, `analytics`; feature flags are explicit booleans and limits are positive integers (employees may be zero). Editing/disabling a plan never changes previously issued entitlement snapshots until manual renewal.
- Manual workflow: create a pending subscription for an existing restaurant; activate by admin explicitly with a UTC start (default now) and `graceDays`. Owner cannot activate or renew. No payment, invoice, auto-renewal or checkout added.
- Grace days are an **explicit administrator input** each time, from 0 to 365, rather than an assumed 7-day business policy. 0 means no grace. Month/year arithmetic uses real UTC calendar month boundaries (month-end clamping), not 30/365-day approximations.
- Effective state is computed from timestamps, without a scheduled job: pending, scheduled, active, grace, expired, cancelled. Operational capabilities continue throughout grace and stop exactly when the grace deadline is reached. Owner login and `/owner/subscription` remain possible after expiry to see renewal channels.
- When manually renewed before expiry, coverage remains continuous; new term starts at old end, subscription service window stays active without temporarily transitioning to scheduled. During grace, renewal uses original term end; after grace it starts today.
- Each activation/renewal stores immutable `subscription_terms` snapshot, with audited actor and request ID. Concurrent activation is serialized by locking the restaurant; database also enforces one active/pending subscription per tenant. Old expired active record is retired on replacement activation.
- Renewal contacts (up to 10 email/phone/WhatsApp channels) are replaced atomically by an admin and filtered for owner display. If none configured, owner still receives an empty array and can sign in; production onboarding must configure at least one active renewal contact.

## Limitations and future enforcement
- `SubscriptionsService.assertOperational` performs tenant-active, effective date/grace and feature entitlement checks. Future **owner CRUD, employee and public table/call routes** must invoke it and enforce quota counts under the same database transaction that creates a branch/table/employee. Current backend has no such operational CRUD routes. This change **does not** claim those quotas are enforced on nonexistent endpoints.
- No automated payment or plan switch, refunds, analytics, owner contact messaging provider, subscription cancellation or past-term backfill for pre-existing records.
- Grace cap 365 is a validation safeguard, not a billing policy; operator controls the actual explicit value. Contact input is stored verbatim after format validation; frontend must present it safely.
- Runtime integration with dashboards/Expo and staging is NOT yet verified. API generated Swagger is authoritative for implemented endpoints, YAML includes incomplete future endpoint drafts.
- Deployment requires migrated database, backups, secure JWT secret, production hostname/origin configuration and a verified owner renewal path.
