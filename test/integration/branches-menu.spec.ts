import { createHash, randomUUID } from "node:crypto";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { configureHttpApp } from "../../src/bootstrap";
import { hashPassword } from "../../src/common/crypto/password";
import { MEDIA_STORAGE, type MediaStorageGateway } from "../../src/modules/media/infrastructure/media-storage.gateway";
import { MediaService } from "../../src/modules/media/application/media.service";
import sharp from "sharp";

const ADMIN_PASSWORD = "BranchTestAdmin_2026!X";
const OWNER_PASSWORD = "BranchTestOwner_2026!X";
const CHANGED_PASSWORD = "BranchTestOwner_Changed_2026!";
const MEDIA_URL = "https://images.example.test/menu/soup.webp";

describe("Branches, categories, products and independent menu copy (PostgreSQL)", () => {
  let app: INestApplication;
  let pool: Pool;
  let adminToken: string;
  let ownerA: string;
  let ownerB: string;
  let restaurantA: string;
  let restaurantB: string;
  let branchA: string;
  let branchB: string;
  let extraBranch: string;
  let categoryA: string;
  let productA: string;
  const restaurantIds: string[] = [];
  const branchIds: string[] = [];
  const userIds: string[] = [];
  const usernames: string[] = [];
  const planIds: string[] = [];
  const subscriptionIds: string[] = [];
  const storedObjects = new Map<string, Buffer>();
  const storage: MediaStorageGateway = {
    put: async (key, body) => { storedObjects.set(key, body); },
    delete: async key => { storedObjects.delete(key); },
    privateDownloadUrl: async (key) => "https://storage.example.test/signed/" + encodeURIComponent(key),
  };

  const unique = () => "menu_" + randomUUID().replaceAll("-", "");
  const ownerAuth = (token = ownerA) => ({ Authorization: "Bearer " + token });
  const adminAuth = () => ({ Authorization: "Bearer " + adminToken });

  async function loginOwner(username: string): Promise<string> {
    const initial = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username, password: OWNER_PASSWORD, client: "mobile" });
    expect(initial.status).toBe(200);
    const changed = await request(app.getHttpServer()).post("/api/v1/auth/change-password")
      .set("Authorization", "Bearer " + initial.body.data.accessToken)
      .send({ currentPassword: OWNER_PASSWORD, newPassword: CHANGED_PASSWORD });
    expect(changed.status).toBe(200);
    const login = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username, password: CHANGED_PASSWORD, client: "mobile" });
    expect(login.status).toBe(200);
    return login.body.data.accessToken as string;
  }

  async function restaurantWithSubscription(name: string, features = {
    menu: true, waiter_calls: true, hookah_calls: true, analytics: false,
  }) {
    const username = unique();
    const created = await request(app.getHttpServer()).post("/api/v1/admin/restaurants")
      .set(adminAuth()).send({
        name, owner: { name: "Owner", username, initialPassword: OWNER_PASSWORD },
        initialBranch: { name: "Main" },
      });
    expect(created.status).toBe(201);
    const { id, ownerId, branchId } = created.body.data;
    restaurantIds.push(id); branchIds.push(branchId); userIds.push(ownerId); usernames.push(username);
    const plan = await request(app.getHttpServer()).post("/api/v1/admin/plans")
      .set(adminAuth()).send({
        name: unique(), maxBranches: 2, maxTables: 50, maxEmployees: 5, features,
      });
    expect(plan.status).toBe(201);
    planIds.push(plan.body.data.id);
    const pending = await request(app.getHttpServer())
      .post("/api/v1/admin/restaurants/" + id + "/subscriptions").set(adminAuth())
      .send({ planId: plan.body.data.id, period: "monthly" });
    expect(pending.status).toBe(201);
    subscriptionIds.push(pending.body.data.id);
    const activation = await request(app.getHttpServer())
      .post("/api/v1/admin/subscriptions/" + pending.body.data.id + "/activate")
      .set(adminAuth()).send({ graceDays: 3 });
    expect(activation.status).toBe(200);
    return { id: id as string, branchId: branchId as string, token: await loginOwner(username), planId: plan.body.data.id as string };
  }

  afterAll(async () => {
    if (app) await app.close();
    if (pool) {
      await pool.query("DELETE FROM product_images WHERE branch_id = ANY($1::uuid[])", [branchIds]);
      await pool.query("DELETE FROM media_assets WHERE restaurant_id = ANY($1::uuid[])", [restaurantIds]);
      await pool.query("DELETE FROM products WHERE branch_id = ANY($1::uuid[])", [branchIds]);
      await pool.query("DELETE FROM categories WHERE branch_id = ANY($1::uuid[])", [branchIds]);
      await pool.query("DELETE FROM subscription_terms WHERE subscription_id = ANY($1::uuid[])", [subscriptionIds]);
      await pool.query("DELETE FROM audit_logs WHERE restaurant_id = ANY($1::uuid[]) OR actor_user_id = ANY($2::uuid[])", [restaurantIds, userIds]);
      await pool.query("DELETE FROM subscriptions WHERE id = ANY($1::uuid[])", [subscriptionIds]);
      await pool.query("DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])", [userIds]);
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
      await pool.query("DELETE FROM branches WHERE id = ANY($1::uuid[])", [branchIds]);
      await pool.query("DELETE FROM restaurants WHERE id = ANY($1::uuid[])", [restaurantIds]);
      await pool.query("DELETE FROM plans WHERE id = ANY($1::uuid[])", [planIds]);
      for (const username of usernames) {
        await pool.query("DELETE FROM auth_login_attempts WHERE identity_hash = $1", [
          createHash("sha256").update(username.toLowerCase()).digest("hex"),
        ]);
      }
      await pool.end();
    }
  });

  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") throw new Error("Only isolated testing is allowed");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MEDIA_STORAGE).useValue(storage).compile();
    app = module.createNestApplication();
    configureHttpApp(app);
    await app.init();
    const adminName = unique();
    const adminId = randomUUID();
    usernames.push(adminName); userIds.push(adminId);
    await pool.query(
      `INSERT INTO users (id,username,display_name,password_hash,role,must_change_password)
       VALUES ($1,$2,'Menu Test Admin',$3,'PRIMARY_ADMIN',false)`,
      [adminId, adminName, await hashPassword(ADMIN_PASSWORD)],
    );
    const adminLogin = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username: adminName, password: ADMIN_PASSWORD, client: "mobile" });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.data.accessToken;
    const a = await restaurantWithSubscription("Menu Test A");
    const b = await restaurantWithSubscription("Menu Test B");
    restaurantA = a.id; restaurantB = b.id;
    branchA = a.branchId; branchB = b.branchId;
    ownerA = a.token; ownerB = b.token;
  });

  it("discovers active public branches by restaurant UUID without exposing credentials", async () => {
    const discovered = await request(app.getHttpServer())
      .get("/api/v1/public/menu/restaurants/" + restaurantA + "/branches");
    expect(discovered.status).toBe(200);
    expect(discovered.body.data.restaurant.id).toBe(restaurantA);
    expect(discovered.body.data.branches).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: branchA, name: "Main", slug: expect.any(String) }),
    ]));
    expect(JSON.stringify(discovered.body)).not.toContain("password");
    expect(JSON.stringify(discovered.body)).not.toContain("qrToken");
    expect((await request(app.getHttpServer())
      .get("/api/v1/public/menu/restaurants/not-an-id/branches")).status).toBe(400);
    expect((await request(app.getHttpServer())
      .get("/api/v1/public/menu/restaurants/00000000-0000-0000-0000-000000000000/branches")).status).toBe(404);
  });

  it("blocks missing auth, impersonation and cross-tenant branch reads", async () => {
    expect((await request(app.getHttpServer()).get("/api/v1/owner/branches")).status).toBe(401);
    const deniedRole = await request(app.getHttpServer()).get("/api/v1/owner/branches").set(adminAuth());
    expect(deniedRole.status).toBe(403);
    const spoof = await request(app.getHttpServer()).get("/api/v1/owner/branches/" + branchB)
      .set(ownerAuth());
    expect(spoof.status).toBe(404);
    expect((await request(app.getHttpServer()).get("/api/v1/owner/branches/" + branchA)
      .set(ownerAuth())).status).toBe(200);
    const bad = await request(app.getHttpServer()).post("/api/v1/owner/branches").set(ownerAuth())
      .send({ name: "Fake", restaurantId: restaurantB });
    expect(bad.status).toBe(400);
  });

  it("serializes concurrent branch creation and enforces limits including disabled branches", async () => {
    const [a, b] = await Promise.all([
      request(app.getHttpServer()).post("/api/v1/owner/branches").set(ownerAuth())
        .send({ name: "Extra branch A", currency: "USD" }),
      request(app.getHttpServer()).post("/api/v1/owner/branches").set(ownerAuth())
        .send({ name: "Extra branch B", currency: "USD" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 403]);
    const success = a.status === 201 ? a : b;
    extraBranch = success.body.data.id;
    branchIds.push(extraBranch);
    expect(success.body.data.currency).toBe("USD");
    const count = await pool.query<{ n: string }>(
      "SELECT count(*)::text as n FROM branches WHERE restaurant_id = $1", [restaurantA]);
    expect(Number(count.rows[0].n)).toBe(2);
    const disabled = await request(app.getHttpServer()).patch("/api/v1/owner/branches/" + extraBranch)
      .set(ownerAuth()).send({ isActive: false });
    expect(disabled.status).toBe(200);
    expect((await request(app.getHttpServer()).post("/api/v1/owner/branches")
      .set(ownerAuth()).send({ name: "Limit escape" })).status).toBe(403);
    const reenabled = await request(app.getHttpServer()).patch("/api/v1/owner/branches/" + extraBranch)
      .set(ownerAuth()).send({ isActive: true });
    expect(reenabled.status).toBe(200);
    const listed = await request(app.getHttpServer()).get("/api/v1/owner/branches?limit=1")
      .set(ownerAuth());
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.meta.hasMore).toBe(true);
    const page2 = await request(app.getHttpServer()).get("/api/v1/owner/branches?limit=1&cursor=" +
      encodeURIComponent(listed.body.meta.nextCursor)).set(ownerAuth());
    expect(page2.status).toBe(200);
    expect(page2.body.data[0].id).not.toBe(listed.body.data[0].id);
  });

  it("creates category and product only with a branch currency and matching category", async () => {
    const category = await request(app.getHttpServer()).post("/api/v1/owner/branches/" + branchA + "/categories")
      .set(ownerAuth()).send({ name: "شوربات", description: "ساخنة", sortOrder: 3 });
    expect(category.status).toBe(201);
    categoryA = category.body.data.id;

    const withoutCurrency = await request(app.getHttpServer()).post("/api/v1/owner/branches/" + branchA + "/products")
      .set(ownerAuth()).send({ categoryId: categoryA, name: "Lentil soup", priceMinor: 1500 });
    expect(withoutCurrency.status).toBe(409);
    expect(withoutCurrency.body.error.code).toBe("BRANCH_CURRENCY_REQUIRED");
    const setCurrency = await request(app.getHttpServer()).patch("/api/v1/owner/branches/" + branchA)
      .set(ownerAuth()).send({ currency: "USD" });
    expect(setCurrency.status).toBe(200);
    const externalCategory = await request(app.getHttpServer())
      .post("/api/v1/owner/branches/" + branchB + "/categories")
      .set(ownerAuth(ownerB)).send({ name: "Other restaurant category" });
    expect(externalCategory.status).toBe(201);
    const crossBranch = await request(app.getHttpServer()).post("/api/v1/owner/branches/" + branchA + "/products")
      .set(ownerAuth()).send({ categoryId: externalCategory.body.data.id, name: "Spoof", priceMinor: 100 });
    expect(crossBranch.status).toBe(404);

    const product = await request(app.getHttpServer()).post("/api/v1/owner/branches/" + branchA + "/products")
      .set(ownerAuth()).send({
        categoryId: categoryA, name: "شوربة عدس", description: "بدون إضافات",
        priceMinor: 1500, oldPriceMinor: 2000, tags: ["hot", "vegan"],
        isVisible: true, isSoldOut: true, images: [{ url: MEDIA_URL, alt: "Bowl of soup" }],
      });
    expect(product.status).toBe(201);
    productA = product.body.data.id;
    expect(product.body.data).toMatchObject({
      priceMinor: 1500, oldPriceMinor: 2000, currency: "USD", isSoldOut: true,
      images: [{ url: MEDIA_URL, alt: "Bowl of soup", sortOrder: 0 }],
    });
    const duplicate = await request(app.getHttpServer())
      .post("/api/v1/owner/branches/" + branchA + "/categories")
      .set(ownerAuth()).send({ name: "شوربات" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("CATEGORY_NAME_TAKEN");
  });

  it("rejects bad price, invalid media origin, oversized collections and cross-tenant product access", async () => {
    const endpoint = "/api/v1/owner/branches/" + branchA + "/products";
    const invalid = await request(app.getHttpServer()).post(endpoint).set(ownerAuth())
      .send({ categoryId: categoryA, name: "Invalid", priceMinor: 1500, oldPriceMinor: 1000 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("INVALID_OLD_PRICE");
    const forbiddenMedia = await request(app.getHttpServer()).post(endpoint).set(ownerAuth())
      .send({ categoryId: categoryA, name: "Malicious", priceMinor: 1500,
        images: [{ url: "https://attacker.example.org/tracker.png" }] });
    expect(forbiddenMedia.status).toBe(400);
    expect(forbiddenMedia.body.error.code).toBe("MEDIA_ORIGIN_NOT_ALLOWED");
    const noMediaHost = await request(app.getHttpServer()).post(endpoint).set(ownerAuth())
      .send({ categoryId: categoryA, name: "Non secure", priceMinor: 1500, images: [{ url: "http://images.example.test/x.png" }] });
    expect(noMediaHost.status).toBe(400);
    const tooMany = await request(app.getHttpServer()).post(endpoint).set(ownerAuth())
      .send({ categoryId: categoryA, name: "Overflow", priceMinor: 500,
        images: Array.from({ length: 9 }, () => ({ url: MEDIA_URL })) });
    expect(tooMany.status).toBe(400);

    const crossTenant = await request(app.getHttpServer()).get(endpoint + "/" + productA)
      .set(ownerAuth(ownerB));
    expect(crossTenant.status).toBe(404);
    const wrongBranch = await request(app.getHttpServer())
      .get("/api/v1/owner/branches/" + branchB + "/products/" + productA).set(ownerAuth(ownerB));
    expect(wrongBranch.status).toBe(404);
    const invalidLimit = await request(app.getHttpServer()).get(endpoint + "?limit=101").set(ownerAuth());
    expect(invalidLimit.status).toBe(400);
  });

  it("publishes only visible products in the public paginated catalog; sold-out remains visible", async () => {
    const page = await request(app.getHttpServer()).get("/api/v1/public/menu/" + (await pool.query(
      "SELECT slug FROM branches WHERE id = $1", [branchA])).rows[0].slug);
    expect(page.status).toBe(200);
    expect(page.body.data.products).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: productA, isSoldOut: true, currency: "USD" }),
    ]));
    expect(page.body.data).not.toHaveProperty("sessionToken");
    expect(page.body.data).not.toHaveProperty("callSettings");
    expect(page.body.data).not.toHaveProperty("qrToken");
    const categoryList = await request(app.getHttpServer())
      .get("/api/v1/public/menu/" + page.body.data.branch.slug + "/categories");
    expect(categoryList.status).toBe(200);
    expect(categoryList.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: categoryA }),
    ]));
    const hidden = await request(app.getHttpServer()).patch("/api/v1/owner/branches/" + branchA + "/products/" + productA)
      .set(ownerAuth()).send({ isVisible: false, isSoldOut: false });
    expect(hidden.status).toBe(200);
    const invisible = await request(app.getHttpServer()).get("/api/v1/public/menu/" + page.body.data.branch.slug);
    expect(invisible.status).toBe(200);
    expect(invisible.body.data.products).toHaveLength(0);
    const show = await request(app.getHttpServer()).patch("/api/v1/owner/branches/" + branchA + "/products/" + productA)
      .set(ownerAuth()).send({ isVisible: true });
    expect(show.status).toBe(200);
  });

  it("copies categories, products and image metadata into another branch with independent IDs and edits", async () => {
    const copied = await request(app.getHttpServer())
      .post("/api/v1/owner/branches/" + extraBranch + "/menu/copy-from")
      .set(ownerAuth()).send({ sourceBranchId: branchA, includeTemplate: false });
    expect(copied.status).toBe(201);
    expect(copied.body.data).toMatchObject({ categoriesCopied: 1, productsCopied: 1 });
    const clonedCategories = await request(app.getHttpServer())
      .get("/api/v1/owner/branches/" + extraBranch + "/categories").set(ownerAuth());
    const clonedProducts = await request(app.getHttpServer())
      .get("/api/v1/owner/branches/" + extraBranch + "/products").set(ownerAuth());
    expect(clonedCategories.status).toBe(200);
    expect(clonedProducts.status).toBe(200);
    expect(clonedCategories.body.data).toHaveLength(1);
    expect(clonedProducts.body.data).toHaveLength(1);
    const clonedCategory = clonedCategories.body.data[0];
    const clonedProduct = clonedProducts.body.data[0];
    expect(clonedCategory.id).not.toBe(categoryA);
    expect(clonedProduct.id).not.toBe(productA);
    expect(clonedProduct.images[0].url).toBe(MEDIA_URL);
    expect(clonedProduct.categoryId).toBe(clonedCategory.id);
    const patchCloned = await request(app.getHttpServer())
      .patch("/api/v1/owner/branches/" + extraBranch + "/products/" + clonedProduct.id)
      .set(ownerAuth()).send({ name: "Changed only in cloned branch", priceMinor: 2500, oldPriceMinor: null });
    expect(patchCloned.status).toBe(200);
    const original = await request(app.getHttpServer())
      .get("/api/v1/owner/branches/" + branchA + "/products/" + productA).set(ownerAuth());
    expect(original.status).toBe(200);
    expect(original.body.data.name).toBe("شوربة عدس");
    expect(original.body.data.priceMinor).toBe(1500);
    const again = await request(app.getHttpServer())
      .post("/api/v1/owner/branches/" + extraBranch + "/menu/copy-from")
      .set(ownerAuth()).send({ sourceBranchId: branchA });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("MENU_TARGET_NOT_EMPTY");
    const crossTenant = await request(app.getHttpServer())
      .post("/api/v1/owner/branches/" + extraBranch + "/menu/copy-from")
      .set(ownerAuth()).send({ sourceBranchId: branchB });
    expect(crossTenant.status).toBe(404);
  });

  it("orders owner and public categories/products by sortOrder with stable cursor pages", async () => {
    const secondCategory = await request(app.getHttpServer())
      .post("/api/v1/owner/branches/" + branchA + "/categories").set(ownerAuth())
      .send({ name: "إضافات", sortOrder: 90 });
    expect(secondCategory.status).toBe(201);
    const secondProduct = await request(app.getHttpServer())
      .post("/api/v1/owner/branches/" + branchA + "/products").set(ownerAuth())
      .send({ categoryId: categoryA, name: "Soup side", priceMinor: 2000, sortOrder: 20 });
    expect(secondProduct.status).toBe(201);
    const slug = (await pool.query("SELECT slug FROM branches WHERE id=$1", [branchA])).rows[0].slug;
    for (const url of [
      "/api/v1/owner/branches/" + branchA + "/products",
      "/api/v1/public/menu/" + slug,
    ]) {
      const read = (u: string) => {
        const req = request(app.getHttpServer()).get(u);
        return url.includes("/owner/") ? req.set(ownerAuth()) : req;
      };
      const first = await read(url + "?limit=1");
      expect(first.status).toBe(200);
      const firstData = url.includes("/owner/") ? first.body.data : first.body.data.products;
      expect(firstData[0].id).toBe(productA);
      expect(first.body.meta.hasMore).toBe(true);
      const next = await read(url + "?limit=1&cursor=" + encodeURIComponent(first.body.meta.nextCursor));
      expect(next.status).toBe(200);
      const nextData = url.includes("/owner/") ? next.body.data : next.body.data.products;
      expect(nextData[0].id).toBe(secondProduct.body.data.id);
    }
    const categories = await request(app.getHttpServer())
      .get("/api/v1/public/menu/" + slug + "/categories?limit=1");
    expect(categories.status).toBe(200);
    expect(categories.body.data[0].id).toBe(categoryA);
    const categoriesNext = await request(app.getHttpServer())
      .get("/api/v1/public/menu/" + slug + "/categories?limit=1&cursor=" +
        encodeURIComponent(categories.body.meta.nextCursor));
    expect(categoriesNext.status).toBe(200);
    expect(categoriesNext.body.data[0].id).toBe(secondCategory.body.data.id);
    const ownerCategories = await request(app.getHttpServer())
      .get("/api/v1/owner/branches/" + branchA + "/categories?limit=1").set(ownerAuth());
    expect(ownerCategories.status).toBe(200);
    expect(ownerCategories.body.data[0].id).toBe(categoryA);
  });

  it("enforces category archival and branch currency safeguards without deleting history", async () => {
    const currency = await request(app.getHttpServer()).patch("/api/v1/owner/branches/" + branchA)
      .set(ownerAuth()).send({ currency: "EUR" });
    expect(currency.status).toBe(409);
    expect(currency.body.error.code).toBe("BRANCH_CURRENCY_IN_USE");
    const categoryArchived = await request(app.getHttpServer())
      .delete("/api/v1/owner/branches/" + branchA + "/categories/" + categoryA).set(ownerAuth());
    expect(categoryArchived.status).toBe(200);
    const stored = await pool.query("SELECT count(*)::int AS n FROM products WHERE id = $1", [productA]);
    expect(stored.rows[0].n).toBe(1);
    const publicRead = await request(app.getHttpServer()).get("/api/v1/public/menu/" +
      (await pool.query("SELECT slug FROM branches WHERE id = $1", [branchA])).rows[0].slug);
    expect(publicRead.status).toBe(200);
    expect(publicRead.body.data.products).toHaveLength(0);
    const archivedCategory = await request(app.getHttpServer())
      .get("/api/v1/owner/branches/" + branchA + "/categories/" + categoryA).set(ownerAuth());
    expect(archivedCategory.status).toBe(404);
  });

  it("blocks operational/public menu access on feature removal or expiry, but owner can read renewal status", async () => {
    // New subscriptions with menu=false never expose a menu to public.
    const falseFeature = await restaurantWithSubscription("Menu disabled", {
      menu: false, waiter_calls: true, hookah_calls: false, analytics: false,
    });
    const blocked = await request(app.getHttpServer())
      .post("/api/v1/owner/branches/" + falseFeature.branchId + "/categories")
      .set(ownerAuth(falseFeature.token)).send({ name: "Not allowed" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PLAN_FEATURE_DISABLED");

    const previous = await pool.query("SELECT starts_at,ends_at,grace_ends_at FROM subscriptions WHERE id = $1",
      [subscriptionIds[0]]);
    const expiredStart = new Date(Date.now() - 60 * 86400_000);
    const expiredDate = new Date(Date.now() - 30 * 86400_000);
    await pool.query("UPDATE subscriptions SET starts_at=$2, ends_at=$3, grace_ends_at=$3 WHERE id=$1",
      [subscriptionIds[0], expiredStart, expiredDate]);
    try {
      const ownerDenied = await request(app.getHttpServer())
        .get("/api/v1/owner/branches").set(ownerAuth());
      expect(ownerDenied.status).toBe(403);
      expect(ownerDenied.body.error.code).toBe("SUBSCRIPTION_INACTIVE");
      const ownerStatus = await request(app.getHttpServer())
        .get("/api/v1/owner/subscription").set(ownerAuth());
      expect(ownerStatus.status).toBe(200);
      expect(ownerStatus.body.data).toMatchObject({ canOperate: false });
      const slug = (await pool.query("SELECT slug FROM branches WHERE id = $1", [branchA])).rows[0].slug;
      const publicRead = await request(app.getHttpServer()).get("/api/v1/public/menu/" + slug);
      expect(publicRead.status).toBe(403);
      expect(publicRead.body.error.code).toBe("SUBSCRIPTION_INACTIVE");
    } finally {
      await pool.query("UPDATE subscriptions SET starts_at=$2, ends_at=$3, grace_ends_at=$4 WHERE id=$1",
        [subscriptionIds[0], previous.rows[0].starts_at, previous.rows[0].ends_at,
          previous.rows[0].grace_ends_at]);
    }
  });

  it("uploads optimized images and private PDFs, secures tenant galleries and reclaims unused files", async () => {
    const media = "/api/v1/owner/branches/" + branchA + "/media";
    const auth = ownerAuth();
    const png = await sharp({ create: {
      width: 32, height: 24, channels: 3, background: "#00ccaa",
    } }).png().toBuffer();
    const missingAuth = await request(app.getHttpServer()).post(media + "/images")
      .attach("file", png, { filename: "photo.png", contentType: "image/png" });
    expect(missingAuth.status).toBe(401);
    const wrongTenant = await request(app.getHttpServer()).post(media + "/images")
      .set(ownerAuth(ownerB)).attach("file", png, { filename: "photo.png", contentType: "image/png" });
    expect(wrongTenant.status).toBe(404);
    const spoofed = await request(app.getHttpServer()).post(media + "/images").set(auth)
      .attach("file", Buffer.from("<svg>not an image</svg>"),
        { filename: "spoof.png", contentType: "image/png" });
    expect(spoofed.status).toBe(415);
    const image = await request(app.getHttpServer()).post(media + "/images").set(auth)
      .attach("file", png, { filename: "photo.png", contentType: "image/png" });
    expect(image.status).toBe(201);
    expect(image.body.data).toMatchObject({ kind: "image", contentType: "image/webp",
      width: 32, height: 24 });
    expect(image.body.data.url).toMatch(/^https:\/\/cdn\.example\.test\/r\//);
    expect(JSON.stringify(image.body)).not.toContain("object_key");
    const imageId = image.body.data.id as string;
    const jpeg = await sharp(png).jpeg().toBuffer();
    const other = await request(app.getHttpServer()).post(media + "/images").set(auth)
      .attach("file", jpeg, { filename: "second.jpeg", contentType: "image/jpeg" });
    expect(other.status).toBe(201);
    const image2Id = other.body.data.id as string;
    expect(storedObjects.size).toBeGreaterThanOrEqual(2);
    const meta = await sharp([...storedObjects.values()][0]).metadata();
    expect(meta.format).toBe("webp");
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
    const document = await request(app.getHttpServer()).post(media + "/documents").set(auth)
      .attach("file", pdf, { filename: "guide.pdf", contentType: "application/pdf" });
    expect(document.status).toBe(201);
    expect(document.body.data).toMatchObject({ kind: "document", contentType: "application/pdf", url: null });
    const documentId = document.body.data.id as string;
    const privateRead = await request(app.getHttpServer()).get(media + "/" + documentId + "/download").set(auth);
    expect(privateRead.status).toBe(200);
    expect(privateRead.headers["cache-control"]).toBe("no-store");
    expect(privateRead.body.data.expiresInSeconds).toBe(60);
    expect(privateRead.body.data.url).toContain("signed");
    expect((await request(app.getHttpServer()).get(media + "/" + documentId + "/download")
      .set(ownerAuth(ownerB))).status).toBe(404);
    const allMedia = await request(app.getHttpServer()).get(media + "?limit=2").set(auth);
    expect(allMedia.status).toBe(200);
    expect(allMedia.body.data).toHaveLength(2);
    expect(allMedia.body.meta.hasMore).toBe(true);
    const nextPage = await request(app.getHttpServer())
      .get(media + "?limit=2&cursor=" + encodeURIComponent(allMedia.body.meta.nextCursor)).set(auth);
    expect(nextPage.status).toBe(200);
    expect(nextPage.body.data).toHaveLength(1);

    const category = await request(app.getHttpServer())
      .post("/api/v1/owner/branches/" + branchA + "/categories")
      .set(auth).send({ name: "Media Category" });
    expect(category.status).toBe(201);
    const product = await request(app.getHttpServer())
      .post("/api/v1/owner/branches/" + branchA + "/products")
      .set(auth).send({ categoryId: category.body.data.id, name: "Media Product", priceMinor: 2100 });
    expect(product.status).toBe(201);
    const productId = product.body.data.id as string;
    const gallery = "/api/v1/owner/branches/" + branchA + "/products/" + productId + "/gallery";
    const foreignMedia = await request(app.getHttpServer()).put(gallery).set(auth)
      .send({ images: [{ mediaId: documentId }] });
    expect(foreignMedia.status).toBe(404);
    const duplicate = await request(app.getHttpServer()).put(gallery).set(auth)
      .send({ images: [{ mediaId: imageId }, { mediaId: imageId }] });
    expect(duplicate.status).toBe(400);
    const reordered = await request(app.getHttpServer()).put(gallery).set(auth)
      .send({ images: [{ mediaId: image2Id, alt: "main" }, { mediaId: imageId, alt: "second" }] });
    expect(reordered.status).toBe(200);
    expect(reordered.body.data).toMatchObject([
      { mediaId: image2Id, sortOrder: 0, isPrimary: true, alt: "main" },
      { mediaId: imageId, sortOrder: 1, isPrimary: false, alt: "second" },
    ]);
    const firstProduct = await request(app.getHttpServer()).get(
      "/api/v1/owner/branches/" + branchA + "/products/" + productId).set(auth);
    expect(firstProduct.body.data.images.map((x: { mediaId: string }) => x.mediaId))
      .toEqual([image2Id, imageId]);
    const slug = (await pool.query("SELECT slug FROM branches WHERE id=$1", [branchA])).rows[0].slug;
    const publicMenu = await request(app.getHttpServer()).get("/api/v1/public/menu/" + slug);
    expect(publicMenu.status).toBe(200);
    const visible = publicMenu.body.data.products.find((p: { id: string }) => p.id === productId);
    expect(visible.images[0].mediaId).toBe(image2Id);
    expect((await request(app.getHttpServer()).delete(media + "/" + imageId).set(auth)).status).toBe(409);

    const crossRestaurantGallery = "/api/v1/owner/branches/" + branchB + "/products/" + productId + "/gallery";
    expect((await request(app.getHttpServer()).put(crossRestaurantGallery).set(ownerAuth(ownerB))
      .send({ images: [{ mediaId: imageId }] })).status).toBe(404);
    expect((await request(app.getHttpServer()).get(media + "/" + imageId + "/download").set(auth)).status).toBe(404);
    const cleared = await request(app.getHttpServer()).put(gallery).set(auth).send({ images: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toEqual([]);
    const removed = await request(app.getHttpServer()).delete(media + "/" + imageId).set(auth);
    expect(removed.status).toBe(200);
    expect(removed.body.data.deleted).toBe(true);
    const stored = await pool.query("SELECT status FROM media_assets WHERE id=$1", [imageId]);
    expect(stored.rows[0].status).toBe("deleted");
    // After 7 days of no references, the bounded cleanup command removes the second image.
    await pool.query("UPDATE media_assets SET created_at=now()-interval '8 days' WHERE id=$1", [image2Id]);
    const result = await app.get(MediaService).cleanup();
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    const deleted = await pool.query("SELECT status FROM media_assets WHERE id=$1", [image2Id]);
    expect(deleted.rows[0].status).toBe("deleted");
    expect((await request(app.getHttpServer()).delete(media + "/" + documentId).set(auth)).status).toBe(200);
  });

  it("documents all implemented branch/menu paths in generated Swagger", async () => {
    const schema = await request(app.getHttpServer()).get("/api/docs-json");
    expect(schema.status).toBe(200);
    const paths = schema.body.paths;
    expect(paths["/api/v1/owner/branches"].post).toBeDefined();
    expect(paths["/api/v1/owner/branches/{branchId}/categories"].post).toBeDefined();
    expect(paths["/api/v1/owner/branches/{branchId}/products"].post).toBeDefined();
    expect(paths["/api/v1/owner/branches/{branchId}/menu/copy-from"].post).toBeDefined();
    expect(paths["/api/v1/public/menu/{slug}"].get).toBeDefined();
  });
});
