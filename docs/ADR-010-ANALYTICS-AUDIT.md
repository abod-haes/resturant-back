# ADR-010 — Bounded UTC analytics and restricted audit reads

Date: 2026-11-20. Status: Accepted backend slice v1.10.

## Decisions and risk boundaries
- Analytics is a paid plan feature. Require RESTAURANT_OWNER and `requireOperationalEntitlements(restaurantId,"analytics")` *before* querying any statistics. Restaurant scope comes from the authenticated server-side principal. Any branchId filter is verified to belong to this restaurant and yields 404 otherwise; no cross-tenant compare endpoint.
- Accept date-only YYYY-MM-DD in UTC only. Window [from,to) is 1..90 calendar days, default 30 UTC days including current partial day. Invalid/impossible dates, unpaired bounds, zero/negative/overlength ranges yield 400. Query uses indexed created_at BETWEEN with an **exclusive** end to avoid off-by-one at midnight and daylight-saving time ambiguity.
- PostgreSQL aggregation is pushed to the database with COUNT/FILTER and COUNT(DISTINCT table_id), not a SELECT * of call events into Node. Daily response is bound to <=90 days and fills missing dates with zeros. Aggregate historical service_calls even if tables/employees are archived. Never infer that a worker/handset acknowledged the call; `routedCalls` means only that the call was recorded with eligible staff at that time. Call-only application intentionally has no revenue or checkout metrics.
- Global audit read is **PRIMARY_ADMIN ONLY**. The existing role matrix does not approve PLATFORM_ADMIN audit delegation, tenant owners or staff audit access. Reuse existing audit_logs; never select/return raw `metadata`, which may contain private operational notes, secrets or contacts. Explicit safe fields only, stable (created_at,id) cursor, defaults 20 max 100, exact-match filters.
- Read-only endpoints, no personal identifiers of customers, QR/session/device tokens, or arbitrary metadata. Add forward-only indexes on (created_at,id), (restaurant_id,created_at,id), and service call time by restaurant+branch. No changes to applied migration checksums.

## Deferred / production acceptance
- Admin dashboard/restaurant dashboard mock/live adapter and UI integration require independent staging test; back-end PR does not claim client work. A complete audit-coverage inventory, retention policy, database backup/restore rehearsal, load testing, and production alerting remain for pilot/operations milestone.
- Data aggregation is on-demand. If query volume increases, consider materialized rollups through a measured performance ADR; do not add Redis or a new service prematurely.
