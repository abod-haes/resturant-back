# استمرارية جلسة Dashboard محلياً مع Live API مباشر

## المشكلة
عندما يكون Dashboard على http://localhost:5173 وBackend على https://resturen-api.abdulrahman-hares.com، يُمنع إرسال Refresh Cookie من نوع SameSite=Strict عبر المواقع المختلفة، فيرجع POST /auth/refresh: 401 Refresh credential required حتى لو نجح Login.

## الحل (خيار صريح، بدون Proxy)

على خدمة restaurant-backend في Dokploy أضف:

```dotenv
AUTH_CROSS_SITE_COOKIE=true
```

احتفظ بـ `CORS_ORIGINS=*` إن أردت (هذا يفتح Origins كلها ويسمح لمواقع غير موثوقة بالاتصال بالـ API؛ قائمة المصادر المحددة أفضل أمنياً). **لا** تغيّر إعدادات الفرونت أو `VITE_API_BASE_URL`: الاتصال يبقى مباشرة بدومين HTTPS الحقيقي.

خيار `AUTH_CROSS_SITE_COOKIE=true` يفعّل Refresh Cookie بصيغة:
`HttpOnly; Secure; SameSite=None; Partitioned; Path=/api/v1/auth`.
الخيار الافتراضي `false` يبقي `SameSite=Strict` كما كان. يتطلب تفعيل الخيار `NODE_ENV=production` لأن Cookie يجب أن تكون Secure.

### اختبار
1. Deploy أحدث main في Backend ثم أعِد تشغيل Vite محلياً بعد سحب أحدث main في كلا Dashboard.
2. افتح DevTools > Network، وجرّب Login من `localhost`: Request URL يجب أن يبدأ بـ `https://resturen-api.abdulrahman-hares.com/api/v1/auth/login`، وليس localhost.
3. من تبويب Application / Cookies تأكد أن المتصفح خزّن `restaurant_refresh` تحت دومين API، وأن خيارات `Secure` و`HttpOnly` و`Partitioned` موجودة. لا تشارك قيمة Cookie.
4. أعد تحميل الصفحة. عند وجود Cookie مخزنة وفي متصفح يدعم Partitioned Cookies (مثل Chrome الحديث) يفترض أن يرجع `refresh` 200 وتظهر واجهة الحساب.
5. إذا Chrome أظهر Blocked Set-Cookie افحص سبب الرفض في DevTools > Issues. بعض سياسات المتصفح أو إضافات الخصوصية قد تمنع التخزين، ولا يمكن تجاوزه بإعداد CORS وحده.
6. قبل أول Login لا توجد Cookie، لذا `401 Refresh credential required` طبيعي أثناء bootstrap؛ أما بعد Login فهو غير طبيعي.

**مهم**: لا تُخزّن Refresh Token في LocalStorage أو تبعته في URL. بعد تغيير إعداد سياسة Cookies من Strict إلى Partitioned، سجّل الدخول مرة جديدة لتنزيل Cookie بالشكل الجديد.

في النسخة المنشورة تحت نفس موقع API يمكن الاستمرار بوضع Strict الافتراضي إذا لم يكن هنالك طلبات cross-site.
