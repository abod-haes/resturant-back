# Analytics and Audit — Backend v1.10.0 handoff

Base `/api/v1`. Generated executable Swagger at `/api/docs-json`. This backend change does not modify dashboard repositories; staging integration BLOCKED until tested.

## Restaurant owner: call activity report

GET `/owner/call-analytics` (Bearer RESTAURANT_OWNER) with optional `from=2026-11-01&to=2026-12-01&branchId=<own-UUID>`. Both dates required together; YYYY-MM-DD UTC only, to is exclusive, interval 1–90 calendar days. Without from/to, server uses most recent 30 UTC days (today partially included). Daily array always includes all requested calendar days, including zeros.

Response 200:
```json
{
  "data": {
    "from": "2026-11-19",
    "to": "2026-11-21",
    "branchId": null,
    "summary": {
      "totalCalls": 5, "waiterCalls": 3, "hookahCalls": 2,
      "routedCalls": 4, "noStaffCalls": 1, "distinctTables": 3
    },
    "daily": [
      { "date": "2026-11-19", "totalCalls": 2, "waiterCalls": 2, "hookahCalls": 0, "routedCalls": 1, "noStaffCalls": 1 },
      { "date": "2026-11-20", "totalCalls": 3, "waiterCalls": 1, "hookahCalls": 2, "routedCalls": 3, "noStaffCalls": 0 }
    ]
  }
}
```

Use `summary` for dashboard KPI cards, `daily` for an activity trend, `branchId` for branch-specific filters. `routedCalls` means eligible-staff call routing at time of creation, NOT Expo push delivered or acknowledged. Do not call it `deliveredCalls` or show employee response times. No checkout/monetary data exists. Never display sales metrics here.

Errors: 400 bad date/interval (max 90 days)/invalid UUID; 401 missing auth; 403 wrong role, SUBSCRIPTION_INACTIVE or PLAN_FEATURE_DISABLED; 404 foreign/nonexistent branch. No results is 200 with zero counts and zero-filled daily list, not 404.

## Platform primary admin: audit feed

GET `/admin/audit-logs?restaurantId=<UUID>&actorId=<UUID>&action=subscription.renewed&cursor=<keyset>&limit=20` Bearer PRIMARY_ADMIN only. Date descending, UUID tie-breaker descending; `meta.nextCursor` null on final page. Default page 20, max 100, never request 1000.

Response `{"data":[{"id":"uuid","actorId":"uuid-or-null","restaurantId":"uuid-or-null","action":"subscription.renewed","entityType":"subscription","entityId":"uuid-or-null","requestId":"string-or-null","createdAt":"UTC ISO"}],"meta":{"hasMore":false,"nextCursor":null}}`.

**Never display metadata**, because backend intentionally excludes it. Unauthorized: 401 without token, 403 for PLATFORM_ADMIN/owner/employee. Invalid cursor or filters: 400. No audit writing through this endpoint; reads are administrative only.

## Integration and validation

Use `mocks/contracts/analytics-audit-v1.10.json` as a typed fixture example. Make mock/live adapters return exactly the same DTOs and errors. Verify owner with analytics plan, owner without it, expired subscription, own vs foreign branch, empty periods, bad date boundaries, admin cursor pagination and no sensitive metadata. API CI includes PostgreSQL migrations, TypeScript, architecture/lint, unit + integration, OpenAPI contract and build.

Remaining non-backend work: integrate `apps/restaurant` analytics UI and `apps/admin` primary audit feed, permission/loading/error/empty/RTL states, staging contract smoke tests. No other repositories changed by this PR.
