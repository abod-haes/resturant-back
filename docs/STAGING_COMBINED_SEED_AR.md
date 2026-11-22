# Seed حسابات الإدارة والمطاعم — Staging فقط

هذا السكربت ينشئ حساب **PRIMARY_ADMIN** واحداً، ومالكاً لكل من مطعم الياسمين ومطعم الورد، إضافة إلى المطعمين وفروعهما الثلاثة حسب `mocks/fixtures.json`. لا ينشئ منتجات أو اشتراكات أو طاولات.

## الحسابات الناتجة

| الصلاحية | اسم المستخدم | المطعم |
| --- | --- | --- |
| PRIMARY_ADMIN | `platform.admin` | المنصة |
| RESTAURANT_OWNER | `demo.yasmin.owner` | مطعم الياسمين |
| RESTAURANT_OWNER | `demo.ward.owner` | مطعم الورد |

**لا توجد كلمات مرور ثابتة في Git.** تحدَّد ثلاث كلمات مرور مختلفة وقوية قبل تشغيل الـ Seed. تُخزّن في قاعدة البيانات بشكل hashes، وتُلزم الحسابات الجديدة بتغيير كلمة المرور بأول تسجيل دخول.

## التشغيل

على **قاعدة Staging مستقلة فقط**، وبعد التأكد من `DATABASE_URL` وتشغيل المايغريشن، نفّذ داخل Backend container:

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

استبدل القيم بين `<...>` بقيم حقيقية؛ لا تشاركها في الشات أو ترفعها على GitHub. عند استخدام Dokploy، أضف المتغيرات بشكل مؤقت إلى بيئة خدمة الباك، ثم افتح Terminal ونفّذ الأمر، واحذف المتغيرات المؤقتة بعد النجاح. لا تغيّر `APP_ENV` على خدمة Production؛ استخدم قاعدة بيانات وخدمة Staging منفصلتين.

## السلامة وإعادة التشغيل

- يتطلب `APP_ENV=staging` و`SEED_STAGING_ACCOUNTS_CONFIRM=yes`، وإلا يتوقف قبل أي اتصال بقاعدة البيانات.
- جميع عمليات الإنشاء في Transaction واحدة مع قفل لمنع تشغيل متزامن.
- لا يبدّل كلمات مرور حسابات موجودة، ولا يضيف Primary Admin ثانياً.
- إذا وجد مطعم أو مالك أو فرع بنفس slug/username لكن بمعرّف/ملكية مختلفة يتوقف ويرجع كامل Transaction.
- إعادة التشغيل للحسابات نفسها لا تكررها أو تغير كلمات المرور.
- إذا تم إنشاء حسابات سابقاً بكلمات مرور مختلفة، ستبقى القديمة سارية؛ تحتاج Reset مصرحاً به لتغييرها.
- لا تخلط هذا الأمر مع بيانات Production، ولا تعتبر حسابات الـ Seed موجودة حتى ترى رسالة نجاح فعلية.

للتحقق، استخدم `POST /api/v1/auth/login` ثم `GET /api/v1/auth/me` كما في `docs/AUTH_DASHBOARD_HANDOFF.md`.
