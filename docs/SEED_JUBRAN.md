# Jubran demo reset

Demo restaurant: Jubran, Aleppo, Mocambo. Reference: https://ajabwen.com/restaurants/cmvii0kv8000rz4w459t748bb . Menu, prices, staff, floors and tables are illustrative, not verified real data.

**Danger:** this script truncates operational tables including users, sessions, subscriptions, plans, media metadata and QR credentials. Back up PostgreSQL and stop traffic/workers first. Migration history is preserved. Object storage files are not deleted by SQL. Run only on an authorized demo database.

Run migrations and build first. Set APP_ENV=production or staging, matching SEED_FULL_CONFIRM (I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION or I_UNDERSTAND_THIS_WRITES_TO_STAGING), SEED_REPLACE_CONFIRM=DELETE_ALL_RESTAURANT_DATA, existing DATABASE_URL and QR_TOKEN_ENCRYPTION_KEY. Optional SEED_JUBRAN_LOGO_URL is a verified existing HTTPS logo URL. Otherwise upload original logo through Admin after seed. Run npm run db:seed:jubran -- --dry-run first, then npm run db:seed:jubran. One-time passwords print only after commit; save privately. Domain jubran starts pending. Configure Dokploy and CORS then mark ready through admin. Never rerun casually: all QR and passwords change. 1 restaurant, 1 branch, 2 floors, 4 areas, 50 tables, 12 employees, 80 products, 12 categories, 14 accounts. No fabricated call history.
