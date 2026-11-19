# ADR-006 — Tenant-scoped branch menus and currency
Date: 2026-11-19. Status: Accepted for v1.6 backend slice.

## Decisions
- Branch-owned categories/products and images use composite PostgreSQL foreign keys to enforce branch/tenant integrity. No cross-branch category association can be persisted, even with bypassed application code. Soft archive rather than hard delete retains records and referential history.
- `maxBranches` is enforced in the same transaction as creation, with restaurant-row FOR UPDATE locks across API replicas. Disabled branches count against quota. Future table/employee quota checks must similarly lock the restaurant before counting/writing.
- Operational tenant/feature checks share a single helper reused by SubscriptionService, branches and menus. Owner may read renewal contacts after expiry but **not** branch or catalog management. Public menu requires active/grace menu entitlement.
- Each branch has one currency. Onboarding's initial branch can be currency=null, but product creation is blocked until owner configures it; existing branch currency cannot be changed after any product exists, including archived. Minor-unit prices are int32 0..2147483647; old price must exceed current price; no size/extras/orders.
- Copy menu only into an empty same-tenant branch, and all destination records have new IDs. It is an append-free, non-destructive transaction: avoids silent overwrite and source/target coupling. If target currency is unset, it inherits source currency; mismatch rejects. Copy of floor/table templates is deferred and includeTemplate=true is explicitly rejected rather than silently ignored.
- Image metadata has at most 8 URLs per product. URLs must be HTTPS under configured MEDIA_ALLOWED_ORIGINS (no credentials, query or fragments). No remote fetch or unsafe image host is allowed. **Actual upload ownership, object storage, resizing and CDN provisioning remain unimplemented**, so external image references are only supported for pre-provisioned trusted CDN URLs.
- Anonymous general catalog is paginated, only active categories + visible/live products, and returns no table session or service-call credentials. Sold-out remains visible. Category index available through a separate paginated route.
- Architecture: new independent branches and menu modules, shared pagination and subscription helpers; no cross-module private imports. Staging dashboard/live client integration remains a separate gate.

## Constraints / forward work
- Future QR/table branch routes must use same tenant/currency plan policy and per-table quota with locks. Image upload/transcoding/malware validation and signed object ownership are required before direct user-upload capability.
- No public menu content caching contract finalized; dynamic changes should be reflected via re-fetch until event invalidation exists.
