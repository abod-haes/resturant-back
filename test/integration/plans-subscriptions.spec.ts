import { createHash, randomUUID } from "node:crypto";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { configureHttpApp } from "../../src/bootstrap";
import { hashPassword } from "../../src/common/crypto/password";
import { SubscriptionsService } from "../../src/modules/subscriptions/application/subscriptions.service";

const ADMIN_PASSWORD = "SubscriptionsAdminPassword_2026!";
const OWNER_PASSWORD = "SubscriptionsOwnerPassword_2026!";
const CHANGED_PASSWORD = "SubscriptionsOwnerChangedPassword_2026!";
const features = { menu: true, waiter_calls: true, hookah_calls: false, analytics: false };

describe("Manual plan subscriptions and tenant entitlements (PostgreSQL)", () => {
  let app: INestApplication;
  let pool: Pool;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let currentPlanId: string;
  let subscriptionId: string;
  const userIds: string[] = [];
  const usernames: string[] = [];
  const restaurantIds: string[] = [];
  const branchIds: string[] = [];
  const planIds: string[] = [];
  const subIds: string[] = [];

  const admin = () => ({ Authorization: "Bearer " + adminToken });
  const uniqueName = () => "subtest_" + randomUUID().replaceAll("-", "");

  async function createPlan(name = uniqueName(), override: Record<string, unknown> = {}) {
    const response = await request(app.getHttpServer())
      .post("/api/v1/admin/plans").set(admin())
      .send({ name, maxBranches: 2, maxTables: 50, maxEmployees: 10, features, ...override });
    if (response.status === 201) planIds.push(response.body.data.id);
    return response;
  }

  async function createRestaurant() {
    const username = uniqueName();
    const response = await request(app.getHttpServer())
      .post("/api/v1/admin/restaurants").set(admin()).send({
        name: "Restaurant Subscription Test",
        owner: { name: "Test Owner", username, initialPassword: OWNER_PASSWORD },
        initialBranch: { name: "Main" },
      });
    expect(response.status).toBe(201);
    const { id, ownerId, branchId } = response.body.data;
    restaurantIds.push(id); branchIds.push(branchId); userIds.push(ownerId); usernames.push(username);
    return { id: id as string, username };
  }

  async function createPending(restId: string, planId: string, period: "monthly" | "yearly" = "monthly") {
    const response = await request(app.getHttpServer()).post("/api/v1/admin/restaurants/" + restId + "/subscriptions")
      .set(admin()).send({ planId, period });
    if (response.status === 201) subIds.push(response.body.data.id);
    return response;
  }

  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") throw new Error("Use an isolated test database");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureHttpApp(app);
    await app.init();

    const username = uniqueName();
    const id = randomUUID();
    userIds.push(id); usernames.push(username);
    await pool.query(
      `INSERT INTO users (id, username, display_name, password_hash, role, must_change_password)
       VALUES ($1,$2,'Subscription Admin',$3,'PRIMARY_ADMIN',false)`,
      [id, username, await hashPassword(ADMIN_PASSWORD)],
    );
    const login = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username, password: ADMIN_PASSWORD, client: "mobile" });
    expect(login.status).toBe(200);
    adminToken = login.body.data.accessToken;

    const plan = await createPlan();
    expect(plan.status).toBe(201);
    currentPlanId = plan.body.data.id;

    const restaurant = await createRestaurant();
    restaurantId = restaurant.id;
    const ownerLogin = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username: restaurant.username, password: OWNER_PASSWORD, client: "mobile" });
    expect(ownerLogin.status).toBe(200);
    const changed = await request(app.getHttpServer()).post("/api/v1/auth/change-password")
      .set("Authorization", "Bearer " + ownerLogin.body.data.accessToken)
      .send({ currentPassword: OWNER_PASSWORD, newPassword: CHANGED_PASSWORD });
    expect(changed.status).toBe(200);
    const relogin = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username: restaurant.username, password: CHANGED_PASSWORD, client: "mobile" });
    expect(relogin.status).toBe(200);
    ownerToken = relogin.body.data.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pool) {
      await pool.query("DELETE FROM subscription_terms WHERE subscription_id = ANY($1::uuid[])", [subIds]);
      await pool.query("DELETE FROM audit_logs WHERE restaurant_id = ANY($1::uuid[]) OR actor_user_id = ANY($2::uuid[])", [restaurantIds, userIds]);
      await pool.query("DELETE FROM subscriptions WHERE id = ANY($1::uuid[])", [subIds]);
      await pool.query("DELETE FROM renewal_contacts");
      await pool.query("DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])", [userIds]);
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
      await pool.query("DELETE FROM branches WHERE id = ANY($1::uuid[])", [branchIds]);
      await pool.query("DELETE FROM restaurants WHERE id = ANY($1::uuid[])", [restaurantIds]);
      await pool.query("DELETE FROM plans WHERE id = ANY($1::uuid[])", [planIds]);
      for (const username of usernames) {
        await pool.query("DELETE FROM auth_login_attempts WHERE identity_hash = $1",
          [createHash("sha256").update(username.toLowerCase()).digest("hex")]);
      }
      await pool.end();
    }
  });

  it("validates plans and provides paginated results without leaking owner permissions", async () => {
    const bad = await createPlan(uniqueName(), { maxTables: 0 });
    expect(bad.status).toBe(400);
    const unknownFlag = await createPlan(uniqueName(), { features: { ...features, secret: true } });
    expect(unknownFlag.status).toBe(400);

    const another = await createPlan();
    expect(another.status).toBe(201);
    const first = await request(app.getHttpServer()).get("/api/v1/admin/plans?limit=1").set(admin());
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(1);
    expect(first.body.meta.hasMore).toBe(true);
    const second = await request(app.getHttpServer())
      .get("/api/v1/admin/plans?limit=1&cursor=" + encodeURIComponent(first.body.meta.nextCursor)).set(admin());
    expect(second.status).toBe(200);
    expect(second.body.data[0].id).not.toBe(first.body.data[0].id);
    const cap = await request(app.getHttpServer()).get("/api/v1/admin/plans?limit=101").set(admin());
    expect(cap.status).toBe(400);
    const cursor = await request(app.getHttpServer()).get("/api/v1/admin/plans?cursor=broken").set(admin());
    expect(cursor.status).toBe(400);

    const noBearer = await request(app.getHttpServer()).post("/api/v1/admin/plans").send({ name: "unauthorized" });
    expect(noBearer.status).toBe(401);
    const ownerDenied = await request(app.getHttpServer()).get("/api/v1/admin/plans")
      .set("Authorization", "Bearer " + ownerToken);
    expect(ownerDenied.status).toBe(403);
    const duplicate = await createPlan(another.body.data.name);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("PLAN_NAME_TAKEN");
  });

  it("creates pending subscriptions but denies a second pending one and inactive plans", async () => {
    const before = await request(app.getHttpServer()).get("/api/v1/owner/subscription")
      .set("Authorization", "Bearer " + ownerToken);
    expect(before.status).toBe(200);
    expect(before.body.data).toMatchObject({ subscription: null, renewalContacts: [], canOperate: false });

    const pending = await createPending(restaurantId, currentPlanId);
    expect(pending.status).toBe(201);
    expect(pending.body.data).toMatchObject({ effectiveStatus: "pending", canOperate: false });
    subscriptionId = pending.body.data.id;
    const duplicate = await createPending(restaurantId, currentPlanId);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("SUBSCRIPTION_PENDING");

    const disabled = await createPlan();
    expect(disabled.status).toBe(201);
    const patch = await request(app.getHttpServer()).patch("/api/v1/admin/plans/" + disabled.body.data.id)
      .set(admin()).send({ isActive: false });
    expect(patch.status).toBe(200);
    const other = await createRestaurant();
    const unavailable = await createPending(other.id, disabled.body.data.id);
    expect(unavailable.status).toBe(400);
    expect(unavailable.body.error.code).toBe("PLAN_UNAVAILABLE");
  });

  it("activates manually, snapshots entitlements and exposes status to owner only", async () => {
    const missingGrace = await request(app.getHttpServer()).post("/api/v1/admin/subscriptions/" + subscriptionId + "/activate")
      .set(admin()).send({});
    expect(missingGrace.status).toBe(400);
    const start = new Date(Date.now() - 3000).toISOString();
    const response = await request(app.getHttpServer())
      .post("/api/v1/admin/subscriptions/" + subscriptionId + "/activate")
      .set(admin()).set("x-request-id", "subscription-activate-2026")
      .send({ startsAt: start, graceDays: 7 });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: subscriptionId, restaurantId, effectiveStatus: "active",
      graceDays: 7, canOperate: true,
      entitlements: { maxBranches: 2, maxTables: 50, maxEmployees: 10, features },
    });
    const again = await request(app.getHttpServer()).post("/api/v1/admin/subscriptions/" + subscriptionId + "/activate")
      .set(admin()).send({ graceDays: 7 });
    expect(again.status).toBe(409);

    const mine = await request(app.getHttpServer()).get("/api/v1/owner/subscription")
      .set("Authorization", "Bearer " + ownerToken);
    expect(mine.status).toBe(200);
    expect(mine.body.data.subscription.id).toBe(subscriptionId);
    expect(mine.body.data.canOperate).toBe(true);
    const statusFromOtherTenant = await createRestaurant();
    const otherPending = await createPending(statusFromOtherTenant.id, currentPlanId);
    expect(otherPending.status).toBe(201);
    const adminCurrent = await request(app.getHttpServer())
      .get("/api/v1/admin/restaurants/" + statusFromOtherTenant.id + "/subscription").set(admin());
    expect(adminCurrent.status).toBe(200);
    expect(adminCurrent.body.data.effectiveStatus).toBe("pending");
    const otherOwner = await request(app.getHttpServer()).get("/api/v1/admin/subscriptions/" + subscriptionId)
      .set("Authorization", "Bearer " + ownerToken);
    expect(otherOwner.status).not.toBe(200);
  });

  it("snapshots existing plan entitlements, renews early without losing remaining active time, and records cycles", async () => {
    const oldTerm = await pool.query("SELECT starts_at,ends_at,entitlement_snapshot FROM subscriptions WHERE id = $1", [subscriptionId]);
    const oldStartsAt = oldTerm.rows[0].starts_at.toISOString();
    const oldEndsAt = oldTerm.rows[0].ends_at.getTime();

    const changed = await request(app.getHttpServer()).patch("/api/v1/admin/plans/" + currentPlanId)
      .set(admin()).send({ maxTables: 80, features: { analytics: true } });
    expect(changed.status).toBe(200);
    const unchanged = await pool.query("SELECT entitlement_snapshot FROM subscriptions WHERE id = $1", [subscriptionId]);
    expect(unchanged.rows[0].entitlement_snapshot.maxTables).toBe(50);

    const renewed = await request(app.getHttpServer()).post("/api/v1/admin/subscriptions/" + subscriptionId + "/renew")
      .set(admin()).set("x-request-id", "subscription-renew-2026").send({ graceDays: 5 });
    expect(renewed.status).toBe(200);
    expect(renewed.body.data).toMatchObject({
      effectiveStatus: "active", canOperate: true,
      graceDays: 5, entitlements: { maxTables: 80, features: { ...features, analytics: true } },
    });
    expect(renewed.body.data.startsAt).toBe(oldStartsAt);
    expect(new Date(renewed.body.data.endsAt).getTime()).toBeGreaterThan(oldEndsAt);
    const terms = await pool.query(
      "SELECT sequence, starts_at, ends_at, entitlement_snapshot FROM subscription_terms WHERE subscription_id = $1 ORDER BY sequence",
      [subscriptionId],
    );
    expect(terms.rows).toHaveLength(2);
    expect(terms.rows[1].starts_at.getTime()).toBe(oldEndsAt);
    expect(terms.rows[0].entitlement_snapshot.maxTables).toBe(50);
    expect(terms.rows[1].entitlement_snapshot.maxTables).toBe(80);
    const audit = await pool.query("SELECT request_id FROM audit_logs WHERE entity_id = $1 AND action='subscription.renewed'", [subscriptionId]);
    expect(audit.rows[0].request_id).toBe("subscription-renew-2026");
  });

  it("supports configurable renewal contacts with full replacement and blocks invalid format", async () => {
    const bad = await request(app.getHttpServer()).patch("/api/v1/admin/contact-methods")
      .set(admin()).send({ contacts: [{ type: "email", label: "Support", value: "bad", enabled: true }] });
    expect(bad.status).toBe(400);
    const updated = await request(app.getHttpServer()).patch("/api/v1/admin/contact-methods")
      .set(admin()).send({ contacts: [
        { type: "whatsapp", label: "التجديد", value: "+15550001111", enabled: true },
        { type: "email", label: "Email", value: "support@example.com", enabled: false },
      ] });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toHaveLength(2);
    const owner = await request(app.getHttpServer()).get("/api/v1/owner/subscription")
      .set("Authorization", "Bearer " + ownerToken);
    expect(owner.status).toBe(200);
    expect(owner.body.data.renewalContacts).toEqual([
      { type: "whatsapp", label: "التجديد", value: "+15550001111", enabled: true },
    ]);
    const denied = await request(app.getHttpServer()).patch("/api/v1/admin/contact-methods")
      .set("Authorization", "Bearer " + ownerToken).send({ contacts: [] });
    expect(denied.status).toBe(403);
  });

  it("denies operational access after grace, and archives an expired subscription on replacement", async () => {
    const anotherPlan = await createPlan();
    const otherRestaurant = await createRestaurant();
    const first = await createPending(otherRestaurant.id, anotherPlan.body.data.id);
    expect(first.status).toBe(201);
    const oldStart = new Date(Date.now() - 70 * 86400_000).toISOString();
    const expired = await request(app.getHttpServer())
      .post("/api/v1/admin/subscriptions/" + first.body.data.id + "/activate")
      .set(admin()).send({ startsAt: oldStart, graceDays: 0 });
    expect(expired.status).toBe(200);
    expect(expired.body.data.effectiveStatus).toBe("expired");
    const policy = app.get(SubscriptionsService);
    await expect(policy.assertOperational(otherRestaurant.id)).rejects.toMatchObject({
      response: { code: "SUBSCRIPTION_INACTIVE" },
    });
    await expect(policy.assertOperational(restaurantId, "hookah_calls")).rejects.toMatchObject({
      response: { code: "PLAN_FEATURE_DISABLED" },
    });

    const pending = await createPending(otherRestaurant.id, anotherPlan.body.data.id);
    expect(pending.status).toBe(201);
    const activated = await request(app.getHttpServer())
      .post("/api/v1/admin/subscriptions/" + pending.body.data.id + "/activate")
      .set(admin()).send({ graceDays: 0 });
    expect(activated.status).toBe(200);
    const retired = await pool.query("SELECT status FROM subscriptions WHERE id = $1", [first.body.data.id]);
    expect(retired.rows[0].status).toBe("expired");
    await expect(policy.assertOperational(otherRestaurant.id, "menu")).resolves.toBeUndefined();
  });

  it("documents implemented contract routes in generated OpenAPI", async () => {
    const schema = await request(app.getHttpServer()).get("/api/docs-json");
    expect(schema.status).toBe(200);
    const paths = schema.body.paths;
    expect(paths["/api/v1/admin/plans"].post.responses["201"]).toBeDefined();
    expect(paths["/api/v1/admin/subscriptions/{id}/activate"].post).toBeDefined();
    expect(paths["/api/v1/admin/subscriptions/{id}/renew"].post).toBeDefined();
    expect(paths["/api/v1/owner/subscription"].get).toBeDefined();
    expect(paths["/api/v1/admin/contact-methods"].patch).toBeDefined();
  });
});
