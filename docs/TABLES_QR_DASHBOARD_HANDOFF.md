# Tables & QR v1.7.0 — owner dashboard and public customer handoff

Base path: `/api/v1`, JSON envelopes `{data,meta?}` and standard `{error:{code,message,details?},requestId}`. Owner JWT required for everything under `/owner/`; only RESTAURANT_OWNER can access, never a platform administrator without an explicit support policy. Tenant ID is never submitted from the UI. Public QR resolution uses an opaque token, not a JWT.

| Method | Route | Body / query | Result |
|---|---|---|---|
| GET/POST | /owner/branches/:branchId/floors | GET limit=20,cursor; POST {name,sortOrder?} | page / 201 {data:Floor} |
| PATCH/DELETE | /owner/branches/:branchId/floors/:id | PATCH {name?,sortOrder?,isActive?}; DELETE archives only empty floor | {data:Floor} / {data:{archived:true}} |
| GET/POST | /owner/branches/:branchId/areas | GET limit=20,cursor; POST {floorId,name,sortOrder?} | page / 201 {data:Area} |
| PATCH/DELETE | /owner/branches/:branchId/areas/:id | PATCH {floorId?,name?,sortOrder?,isActive?}; DELETE archives only if no live tables | {data:Area} / archive |
| GET/POST | /owner/branches/:branchId/tables | GET limit=20,cursor; POST {areaId,label,sortOrder?} | page / 201 {data:Table} |
| POST | /owner/branches/:branchId/tables/bulk | {areaId,labels:string[1..50]} | 201 {data:Table[]} |
| GET/PATCH/DELETE | /owner/branches/:branchId/tables/:id | PATCH {areaId?,label?,sortOrder?,isActive?,qrEnabled?,callsEnabled?} | Table / archived |
| GET | /owner/tables/:tableId/qr | — | {data:{url,version,enabled}} |
| POST | /owner/tables/:tableId/qr/rotate | — | 200 {data:{url,version,enabled}} |
| POST | /owner/tables/:tableId/qr/disable | — | 200 {data:{enabled:false,version}} |
| GET | /owner/branches/:branchId/qr/print | optional ?tableIds=UUID,UUID (max 100) | Binary application/pdf, Content-Disposition attachment, no-store |
| GET | /public/t/:qrToken | anonymous | {data:{restaurant:{name},branch:{name,slug},table:{id,label},menuPath,callsAvailable:false}} |

Floor: {id,branchId,name,sortOrder,isActive}. Area: {id,branchId,floorId,name,sortOrder,isActive}. Table: {id,branchId,areaId,label,sortOrder,isActive,qrEnabled,callsEnabled,qrVersion}. Lists use sortOrder ASC/id ASC opaque cursor, limit 20 default/max 100. Changes to table label or area do **not** rotate QR.

All table creates use restaurant-wide maxTables quota atomically, including inactive tables. Archiving table revokes credential and frees a quota slot. Floor cannot be archived while it contains nonarchived areas; area cannot be archived with nonarchived tables. Only active floor/area/branch/table and enabled QR resolve publicly.

**Required deployment configuration:** `QR_TOKEN_ENCRYPTION_KEY` = 32 cryptographically secure random bytes (64 hex chars), kept private and persistent across redeploys. `CUSTOMER_APP_ORIGIN` = HTTPS public customer website origin with no path. Missing config -> owner create/QR rotate/print returns HTTP 503 `QR_NOT_CONFIGURED`. Do not set public QR origin to dashboard or backend. Preserve key backups. QA should check printed QR opens `/t/:token` in customer app.

**Public contract limitation:** `/public/t/:qrToken` returns only table/menu context. Visit-session creation, calling waiter/hookah, 4h inactivity TTL, idempotency and push are **not in this slice**; `callsAvailable:false` is intentional. Don't enable the call UI based only on qrEnabled or callsEnabled. General menu `/public/menu/:slug` remains separate and contains no call/QR credentials.

**Security:** Do not place raw QR token in logs, analytics event payloads, server caches, or broad table-list API responses. QR URLs are bearer capabilities; copied QR may work offsite. On rotate old public URL returns 404 immediately. On disable QR responds 404 until owner PATCHes {qrEnabled:true}; rotate does not silently re-enable.

**Important errors:** 400 for DTO/duplicate labels, 401 unauthenticated, 403 role/plan/expired, 404 tenant-scope/QR unavailable, 409 floor/area nonempty or existing name, 503 QR_NOT_CONFIGURED. Known codes PLAN_LIMIT_REACHED, SUBSCRIPTION_INACTIVE, PLAN_FEATURE_DISABLED, QR_REVOKED, TABLE_LABEL_TAKEN, DUPLICATE_TABLE_LABELS, FLOOR_NAME_TAKEN, AREA_NAME_TAKEN, FLOOR_NOT_EMPTY, AREA_NOT_EMPTY, QR_PRINT_TOO_MANY.

**Print labels:** PDF uses 6 A4 stickers/page. ASCII table labels are printed; Arabic labels currently use a short table-ID fallback pending Arabic font/RTL embedding. QR is correct and scannable. Dashboard should continue showing the actual Arabic table name alongside its print action.

**Integration status:** Backend PR #9. Frontend dashboards, customer app, and deployment not modified or end-to-end verified. The staging handshake must validate 401, 403, 404, 409, 503, scan/disable/rotate, quota, PDF and QR links.
