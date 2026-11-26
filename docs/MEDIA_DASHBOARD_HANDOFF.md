# Media Library and Product Gallery — v1.11 backend handoff

Backend `resturant-back`, API prefix `/api/v1`; executable Swagger `/api/docs-json`. RESTAURANT_OWNER JWT and own active branch/operational menu subscription required.

| Method | Route | Input | Output |
|---|---|---|---|
| POST | /owner/branches/:branchId/media/images | multipart file JPEG/PNG/WebP, max 8 MiB | 201 {data:Media}, converted WebP |
| POST | /owner/branches/:branchId/media/documents | multipart file PDF, max 10 MiB | 201 {data:Media}, url=null |
| GET | /owner/branches/:branchId/media | ?kind=&cursor=&limit=20 | {data:Media[],meta:{hasMore,nextCursor}} |
| GET | /owner/branches/:branchId/media/:id/download | — | {data:{url,expiresInSeconds:60}} for PDF only |
| DELETE | /owner/branches/:branchId/media/:id | — | {data:{deleted:true}} only unused |
| GET | /owner/branches/:branchId/products/:productId/gallery | — | {data:[{id,mediaId,url,alt,sortOrder,isPrimary}]} |
| PUT | /owner/branches/:branchId/products/:productId/gallery | {images:[{mediaId,alt?}]} up to 8 | full ordered gallery, first primary |

Media={id,branchId,kind:"image"|"document",url:string|null,path:string|null,name,contentType,byteSize,width|null,height|null,createdAt}. Never send an arbitrary URL into gallery PUT: use UUIDs returned by upload. Product POST/PATCH accepts ordered images:[{mediaId,alt?}] or legacy [{url,alt?}], exactly one reference per item. Omitted images preserves existing gallery; [] clears it. Product and gallery reads include path for managed assets. Public and authenticated restaurant branding include logoPath; external legacy URLs remain in logoUrl. Clients prefer path with configured media origin, falling back to url.

Design drag-and-drop ordering by replacing array order; the first element is primary. Clearing [] removes all product image links (not the library files); DELETE media works after removing every reference, including in copied-branch galleries. A single restaurant may reuse media across its branches. Distinct restaurant owner IDs cannot read, delete, download or attach each other's assets.

Always display HTTP errors: 400 invalid/duplicate IDs or missing file, 401 no auth, 403 expired subscription/role, 404 cross-tenant or non-ready asset, 409 MEDIA_IN_USE or MEDIA_LIBRARY_LIMIT, 413 too large, 415 invalid/unsupported image/PDF, 503 MEDIA_STORAGE_NOT_CONFIGURED/MEDIA_UPLOAD_FAILED/MEDIA_DELETE_PENDING. Use spinner/progress, and don't confirm upload until 201.

Deploy migrations first, set five MEDIA_S3_* and MEDIA_PUBLIC_ORIGIN values as documented in `.env.example`, ensure a **private bucket** and publicly served **image-only** CDN. PDF documents are never public and only accessible by a 60-second signed download URL from authorized owner requests. Never cache signed URLs. `npm run media:cleanup` can be called on a Dokploy cron: 100 candidates per run; images unreferenced >7 days are removed, docs are not expired. Real-world AV scanning for untrusted PDF is not included.

This PR changes the backend repository only. No dashboard, customer website, production S3/CDN or end-to-end upload was verified; client integration requires its own stage test.

## Restaurant logo and creation flow

- POST /admin/restaurants creates the restaurant, owner and initial branch. Keep a selected logo locally until this succeeds.
- POST /admin/restaurants/:restaurantId/branding/logo accepts multipart file and returns Media. No logo is attached yet.
- PATCH /admin/restaurants/:restaurantId with {branding:{logoMediaId:"<upload id>"}} attaches the ready asset. Use {branding:{logoUrl:null}} to remove it. Legacy logoUrl remains accepted; do not send both fields.
- If upload or attachment fails after create, keep the created restaurant ID and retry only the failed step; never repeat restaurant creation. Preserve the old logo until PATCH succeeds. This intentionally uses the existing two-stage API rather than introducing orphan pre-tenant uploads.
- Run npm run media:cleanup from one scheduled maintenance job (not every API replica). The ready-image selection now excludes referenced rows before the 100-row limit, and rechecks under tenant lock before deleting. Verify signed PDF access and public proxy denial before production approval. No server changes are made by this branch.
