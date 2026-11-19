# Branches & Menu v1.6.0 — owner dashboard + public catalog API handoff

Backend `resturant-back`, canonical generated Swagger `/api/docs-json`, base `/api/v1`. Owner app uses bearer access token from Auth v1.3. No platform-admin support impersonation. Tenant is derived from the authenticated owner, never a request field.

| Method | Path | Request | Response |
|---|---|---|---|
| GET | /owner/branches?limit=20&cursor= | — | {data:Branch[],meta:PageMeta} |
| POST | /owner/branches | {name,currency?:"USD"} | 201 {data:Branch} |
| GET/PATCH | /owner/branches/:branchId | patch {name?,currency?,isActive?} | {data:Branch} |
| GET/POST | /owner/branches/:branchId/categories | GET limit/cursor/search; POST {name,description?,sortOrder?,isActive?} | page / 201 Category |
| GET/PATCH/DELETE | /owner/branches/:branchId/categories/:id | PATCH subset of fields | Category / {data:{archived:true}} |
| GET/POST | /owner/branches/:branchId/products | GET limit/cursor/search; POST CreateProduct | page / 201 Product |
| GET/PATCH/DELETE | /owner/branches/:branchId/products/:id | PATCH subset of fields; images replaces list | Product / {data:{archived:true}} |
| POST | /owner/branches/:branchId/menu/copy-from | {sourceBranchId,includeTemplate?:false} | 201 {data:{categoriesCopied,productsCopied}} |
| GET | /public/menu/:slug?limit=20&cursor=&search= | anonymous | {data:{restaurant,branch,products,categories},meta:PageMeta} |
| GET | /public/menu/:slug/categories?limit=20&cursor=&search= | anonymous | {data:Category[],meta:PageMeta} |

Branch: `{id,name,slug,currency|null,isActive,createdAt}`.
Category: `{id,branchId,name,description|null,sortOrder,isActive,createdAt}`.
Product: `{id,branchId,categoryId,name,description|null,priceMinor,oldPriceMinor|null,currency,tags:string[],isVisible,isSoldOut,sortOrder,images:[{id,url,alt|null,sortOrder}],createdAt}`.
PageMeta: `{nextCursor:string|null,hasMore:boolean}`. Default 20, max 100, newest first; `search` is literal Unicode case-insensitive substring, not wildcard query.

**Important behaviors**
- Owner needs active/grace subscription with `menu` feature. On expiration owner can still access `/owner/subscription` and renewal contacts; menu/branch routes return 403 `SUBSCRIPTION_INACTIVE`.
- Branch creation enforces maxBranches *including inactive branches* atomically; initial onboarding branch counts. Initial currency may be null; set currency before creating products. Currency cannot change while products exist, even archived ones.
- Category and product archive is soft (history preserved). Archiving a category hides its products from public, without deleting them. Hidden products do not appear in public; sold-out products stay visible with `isSoldOut:true`.
- Product images are **HTTPS URL references only**, allowed origins configured with `MEDIA_ALLOWED_ORIGINS` on backend, no SSRF/network fetch and no presigned upload/transcode. Empty allowlist means images cannot be attached. Frontend must not assume images can be uploaded until object-storage pipeline is integrated.
- Copy menu is **non-destructive**: destination must be empty, source/target same tenant. It clones categories/products/image references to fresh IDs. `includeTemplate:true` returns 400 `TEMPLATE_COPY_NOT_AVAILABLE` because table/floor copy comes with QR/tables feature.
- Public catalog includes only categories associated with the current product page; to build a full category selector, page through dedicated `/public/menu/:slug/categories`. General public catalog includes no table QR/session/call capabilities.
- Errors: `{error:{code,message,details?},requestId}` with 400 invalid DTO/old price/media, 401 missing token, 403 role/feature/subscription/plan quota, 404 cross-tenant/missing, 409 name/currency/target conflicts.
- Owner client should handle expired, forbidden, loading, empty list, next page and server errors. Use the same typed DTO schema for live and mock adapter; sample fixture at `mocks/contracts/branch-menu-v1.6.json`.

**Integration status:** API implementation and PostgreSQL integration tests tracked on PR #8. Dashboard and customer repositories unchanged; staging end-to-end adapter check remains BLOCKED.
