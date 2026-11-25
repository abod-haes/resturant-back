# Manual restaurant domains — release checklist
Branch feature/restaurant-subdomain-tenancy. No automatic provisioning.
Before deployment: run architecture/typecheck/lint/build/tests; export runtime OpenAPI and synchronize clients; test migration against a backup copy; do not rotate QR keys.
Backend RESTAURANT_BASE_DOMAIN=abdulrahman-hares.com. Keep CUSTOMER_APP_ORIGIN and QR_TOKEN_ENCRYPTION_KEY unchanged. CORS_ORIGINS must be explicit comma-separated HTTPS origins including all existing frontends and each manually assigned tenant. Do not use wildcard in production.
Vite build VITE_RESTAURANT_BASE_DOMAIN=abdulrahman-hares.com.
For each restaurant assign subdomain in Admin, add customer route / and owner route /dashboard (stripPath=false, port 80, HTTPS Let's Encrypt). Check route priority, assets, TLS and nested refresh before marking ready. No additional DNS record needed if wildcard A is already correct.
Regression: legacy owner and QR links, single/multiple branches, wrong restaurant credentials, wrong-origin QR/menu/session/call, expired subscription with login still accessible, inactive branch, cooldown, QR rotate, print, default and custom identity. Origin checks are browser routing constraints, not proof of presence. Token-based legacy access remains supported.
Outstanding: logo file upload, font selection, runtime contract verification and real deployment smoke checks.
