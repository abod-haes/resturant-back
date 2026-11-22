# Seed حسابات الإدارة والمطاعم — Staging أو Production بتأكيد صريح

هذا السكربت ينشئ حساب **PRIMARY_ADMIN** واحداً، ومالكاً لكل من مطعم الياسمين ومطعم الورد، إضافة إلى المطعمين وفروعهما الثلاثة حسب `mocks/fixtures.json`. لا ينشئ منتجات أو اشتراكات أو طاولات.

## الحسابات الناتجة

| الصلاحية | اسم المستخدم | المطعم |
| --- | --- | --- |
| PRIMARY_ADMIN | `platform.admin` | المنصة |
| RESTAURANT_OWNER | `demo.yasmin.owner` | مطعم الياسمين |
| RESTAURANT_OWNER | `demo.ward.owner` | مطعم الورد |

**لا توجد كلمات مرور ثابتة في Git.** تحدَّد ثلاث كلمات مرور مختلفة وقوية قبل تشغيل الـ Seed. تُخزّن في قاعدة البيانات بشكل hashes، وتُلزم الحسابات الجديدة بتغيير كلمة المرور بأول تسجيل دخول.

## التشغيل

على **قاعدة Staging**، وبعد التأكد من `DATABASE_URL` وتشغيل المايغريشن، نفّذ داخل Backend container:

```bash
npm run db:migrate:check
export APP_ENV=staging
export SEED_STAGING_ACCOUNTS_CONFIRM=yes
export PRIMARY_ADMIN_USERNAME=platform.admin
export PRIMARY_ADMIN_PASSWORD='<random-secret-at-least-12-chars>'
export DEMO_YASMIN_OWNER_PASSWORD='<different-random-secret-at-least-12-chars>'
export DEMO_WARD_OWNER_PASSWORD='<another-different-random-secret-at-least-12-chars>'
npm run db:seed:staging-accounts
unset SEED_STAGING_ACCOUNTS_CONFIRM PRIMARY_ADMIN_USERNAME PRIMARY_ADMIN_PASSWORD DEMO_YASMIN_OWNER_PASSWORD DEMO_WARD_OWNER_PASSWORD
```

استبدل القيم بين `<...>` بقيم حقيقية؛ لا تشاركها في الشات أو ترفعها على GitHub.

## على نفس Backend وPostgreSQL في Production

**تحذير:** هذا يضيف مطعمين تجريبيين وحسابات حقيقية إلى قاعدة الإنتاج الحالية. لا يضيف المنتجات أو الاشتراكات. تأكد من أن هذا هو المقصود، وأن لديك نسخة احتياطية صالحة قبل تشغيل أي Seed على قاعدة إنتاج.

افتح Terminal الحاوية الحالية لخدمة `restaurant-backend` بعد Redeploy من أحدث `main`. تحقق من `npm run db:migrate:check` ثم نفّذ هذه المتغيرات مؤقتاً **داخل جلسة Terminal فقط** (لا تغيّر متغيرات خدمة Production الدائمة)، مع استبدال كلمات المرور:

```bash
export APP_ENV=production
export SEED_PRODUCTION_ACCOUNTS_CONFIRM=I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION
export PRIMARY_ADMIN_USERNAME=platform.admin
export PRIMARY_ADMIN_PASSWORD='<unique-admin-secret-at-least-12-chars>'
export DEMO_YASMIN_OWNER_PASSWORD='<different-yasmin-secret-at-least-12-chars>'
export DEMO_WARD_OWNER_PASSWORD='<different-ward-secret-at-least-12-chars>'
npm run db:seed:staging-accounts
unset SEED_PRODUCTION_ACCOUNTS_CONFIRM PRIMARY_ADMIN_USERNAME PRIMARY_ADMIN_PASSWORD DEMO_YASMIN_OWNER_PASSWORD DEMO_WARD_OWNER_PASSWORD
```

`APP_ENV=production` هنا متغير موقت بجلسة Terminal ولا يغيّر إعدادات خدمة Backend الدائمة. إذا كانت الحسابات قد أُنشئت سابقاً، تبقى كلمات المرور القديمة ولا تُبدّل.



## السلامة وإعادة التشغيل

- يتطلب وضعاً صريحاً: staging مع `SEED_STAGING_ACCOUNTS_CONFIRM=yes` أو production مع `SEED_PRODUCTION_ACCOUNTS_CONFIRM=I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION`، وإلا يتوقف قبل الاتصال بقاعدة البيانات.
- جميع عمليات الإنشاء في Transaction واحدة مع قفل لمنع تشغيل متزامن.
- لا يبدّل كلمات مرور حسابات موجودة، ولا يضيف Primary Admin ثانياً.
- إذا وجد مطعم أو مالك أو فرع بنفس slug/username لكن بمعرّف/ملكية مختلفة يتوقف ويرجع كامل Transaction.
- إعادة التشغيل للحسابات نفسها لا تكررها أو تغير كلمات المرور.
- إذا تم إنشاء حسابات سابقاً بكلمات مرور مختلفة، ستبقى القديمة سارية؛ تحتاج Reset مصرحاً به لتغييرها.
- في Production، سيتم إدخال المطاعم التجريبية فعلياً إلى نفس قاعدة البيانات؛ لا تعتبر الحسابات موجودة حتى ترى رسالة نجاح فعلية.

للتحقق، استخدم `POST /api/v1/auth/login` ثم `GET /api/v1/auth/me` كما في `docs/AUTH_DASHBOARD_HANDOFF.md`.
