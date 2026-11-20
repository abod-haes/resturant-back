import { createHash, randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { configureHttpApp } from "../../src/bootstrap";
import { hashPassword } from "../../src/common/crypto/password";
import { PUSH_GATEWAY, type PushGateway } from "../../src/modules/push/infrastructure/expo-push.gateway";
import { PushDispatcherService } from "../../src/modules/push/application/push-dispatcher.service";

const ADMIN_PASSWORD = "JourneyAdminPassword_2026!";
const INITIAL_OWNER = "JourneyOwnerInitial_2026!";
const CHANGED_OWNER = "JourneyOwnerChanged_2026!";
const INITIAL_STAFF = "JourneyStaffInitial_2026!";
const CHANGED_STAFF = "JourneyStaffChanged_2026!";

describe("Restaurant E2E: onboarding to waiter call on PostgreSQL", () => {
  let app: INestApplication;
  let pool: Pool;
  let adminToken = "", ownerToken = "", foreignOwnerToken = "", staffToken = "";
  let restaurantId = "", branchId = "", foreignBranchId = "", subscriptionId = "";
  let tableOne = "", tableTwo = "", qrOne = "", qrTwo = "", staffId = "", staffVisit = "";
  const users: string[] = [], names: string[] = [];
  const restaurants: string[] = [], branches: string[] = [], plans: string[] = [], subscriptions: string[] = [];
  const fakeSend = jest.fn(async () => ({ ok: true as const, id: "fake-expo-ticket-e2e" }));
  const fakeExpo: PushGateway = {
    send: fakeSend,
    receipts: jest.fn(async (ids: readonly string[]) => Object.fromEntries(
      ids.map(id => [id, { status: "ok" as const }])),
    ),
  };
  const unique = () => "journey_" + randomUUID().replaceAll("-", "");
  const auth = (token: string) => ({ Authorization: "Bearer " + token });
  const owner = () => auth(ownerToken);
  const admin = () => auth(adminToken);
  const ownerPath = (resource: string) => "/api/v1/owner/branches/" + branchId + "/" + resource;

  async function login(name: string, password: string): Promise<string> {
    const result = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username: name, password, client: "mobile" });
    expect(result.status).toBe(200);
    return result.body.data.accessToken as string;
  }
  async function changePassword(name: string, initial: string, changed: string): Promise<string> {
    const token = await login(name, initial);
    const result = await request(app.getHttpServer()).post("/api/v1/auth/change-password")
      .set(auth(token)).send({ currentPassword: initial, newPassword: changed });
    expect(result.status).toBe(200);
    expect((await request(app.getHttpServer()).get("/api/v1/auth/me").set(auth(token))).status).toBe(401);
    return login(name, changed);
  }
  async function onboard(name: string) {
    const username = unique();
    const response = await request(app.getHttpServer()).post("/api/v1/admin/restaurants")
      .set(admin()).send({
        name, owner: { name: "Owner", username, initialPassword: INITIAL_OWNER },
        initialBranch: { name: "Main" },
      });
    expect(response.status).toBe(201);
    const { id, ownerId, branchId: initialBranchId } = response.body.data;
    restaurants.push(id); branches.push(initialBranchId); users.push(ownerId); names.push(username);
    return {
      id: id as string,
      branchId: initialBranchId as string,
      token: await changePassword(username, INITIAL_OWNER, CHANGED_OWNER),
    };
  }
  function publicCall(sessionToken: string, idempotencyKey: string, confirmFirstCall = false) {
    return request(app.getHttpServer()).post("/api/v1/public/calls").send({
      sessionToken, idempotencyKey, type: "waiter", confirmFirstCall,
    });
  }

  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test" || !process.env.DATABASE_URL) {
      throw new Error("E2E requires NODE_ENV=test and dedicated test database");
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const dbName = await pool.query<{ name: string }>("SELECT current_database() AS name");
    if (!dbName.rows[0]?.name.endsWith("_test")) {
      throw new Error("Refusing E2E writes outside a *_test database");
    }
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PUSH_GATEWAY).useValue(fakeExpo).compile();
    app = mod.createNestApplication(); configureHttpApp(app); await app.init();
    // Only the first PRIMARY_ADMIN is a SQL fixture; no public bootstrap API exists.
    const id = randomUUID(), name = unique();
    users.push(id); names.push(name);
    await pool.query(
      "INSERT INTO users (id,username,display_name,password_hash,role,must_change_password) VALUES ($1,$2,'E2E Primary',$3,'PRIMARY_ADMIN',false)",
      [id, name, await hashPassword(ADMIN_PASSWORD)],
    );
    adminToken = await login(name, ADMIN_PASSWORD);

    const first = await onboard("رحلة مطعم الاختبار");
    restaurantId = first.id; branchId = first.branchId; ownerToken = first.token;
    const foreign = await onboard("مطعم آخر معزول");
    foreignBranchId = foreign.branchId; foreignOwnerToken = foreign.token;
    const plan = await request(app.getHttpServer()).post("/api/v1/admin/plans")
      .set(admin()).send({
        name: unique(), maxBranches: 2, maxTables: 3, maxEmployees: 2,
        features: { menu: true, waiter_calls: true, hookah_calls: false, analytics: true },
      });
    expect(plan.status).toBe(201); plans.push(plan.body.data.id);
    const pending = await request(app.getHttpServer())
      .post("/api/v1/admin/restaurants/" + restaurantId + "/subscriptions")
      .set(admin()).send({ planId: plan.body.data.id, period: "monthly" });
    expect(pending.status).toBe(201);
    subscriptionId = pending.body.data.id; subscriptions.push(subscriptionId);
    const activated = await request(app.getHttpServer())
      .post("/api/v1/admin/subscriptions/" + subscriptionId + "/activate")
      .set(admin()).send({ graceDays: 0 });
    expect(activated.status).toBe(200);
    expect(activated.body.data.canOperate).toBe(true);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (!pool) return;
    // FK-ordered test-owned cleanup, never TRUNCATE shared schemas.
    await pool.query("DELETE FROM push_deliveries WHERE outbox_id IN (SELECT id FROM call_outbox WHERE call_id IN (SELECT id FROM service_calls WHERE restaurant_id=ANY($1::uuid[])))", [restaurants]);
    await pool.query("DELETE FROM employee_push_devices WHERE user_id=ANY($1::uuid[])", [users]);
    await pool.query("DELETE FROM realtime_events WHERE restaurant_id=ANY($1::uuid[])", [restaurants]);
    await pool.query("DELETE FROM restaurant_event_counters WHERE restaurant_id=ANY($1::uuid[])", [restaurants]);
    await pool.query("DELETE FROM call_outbox WHERE call_id IN (SELECT id FROM service_calls WHERE restaurant_id=ANY($1::uuid[]))", [restaurants]);
    await pool.query("DELETE FROM owner_alerts WHERE restaurant_id=ANY($1::uuid[])", [restaurants]);
    await pool.query("DELETE FROM service_calls WHERE restaurant_id=ANY($1::uuid[])", [restaurants]);
    await pool.query("DELETE FROM visit_sessions WHERE restaurant_id=ANY($1::uuid[])", [restaurants]);
    await pool.query("DELETE FROM employee_shifts WHERE restaurant_id=ANY($1::uuid[])", [restaurants]);
    await pool.query("DELETE FROM branch_call_settings WHERE branch_id=ANY($1::uuid[])", [branches]);
    await pool.query("DELETE FROM restaurant_call_settings WHERE restaurant_id=ANY($1::uuid[])", [restaurants]);
    await pool.query("DELETE FROM qr_credentials WHERE branch_id=ANY($1::uuid[])", [branches]);
    await pool.query("DELETE FROM restaurant_tables WHERE branch_id=ANY($1::uuid[])", [branches]);
    await pool.query("DELETE FROM areas WHERE branch_id=ANY($1::uuid[])", [branches]);
    await pool.query("DELETE FROM floors WHERE branch_id=ANY($1::uuid[])", [branches]);
    await pool.query("DELETE FROM product_images WHERE branch_id=ANY($1::uuid[])", [branches]);
    await pool.query("DELETE FROM media_assets WHERE restaurant_id=ANY($1::uuid[])", [restaurants]);
    await pool.query("DELETE FROM products WHERE branch_id=ANY($1::uuid[])", [branches]);
    await pool.query("DELETE FROM categories WHERE branch_id=ANY($1::uuid[])", [branches]);
    await pool.query("DELETE FROM subscription_terms WHERE subscription_id=ANY($1::uuid[])", [subscriptions]);
    await pool.query("DELETE FROM audit_logs WHERE restaurant_id=ANY($1::uuid[]) OR actor_user_id=ANY($2::uuid[])", [restaurants, users]);
    await pool.query("DELETE FROM subscriptions WHERE id=ANY($1::uuid[])", [subscriptions]);
    await pool.query("DELETE FROM auth_sessions WHERE user_id=ANY($1::uuid[])", [users]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
    await pool.query("DELETE FROM branches WHERE id=ANY($1::uuid[])", [branches]);
    await pool.query("DELETE FROM restaurants WHERE id=ANY($1::uuid[])", [restaurants]);
    await pool.query("DELETE FROM plans WHERE id=ANY($1::uuid[])", [plans]);
    for (const username of names) {
      await pool.query("DELETE FROM auth_login_attempts WHERE identity_hash=$1", [
        createHash("sha256").update(username.toLowerCase()).digest("hex"),
      ]);
    }
    await pool.end();
  });

  it("creates a public menu and table QR; without staff a confirmed call creates an owner alert", async () => {
    const currency = await request(app.getHttpServer()).patch("/api/v1/owner/branches/" + branchId)
      .set(owner()).send({ currency: "USD" });
    expect(currency.status).toBe(200);
    const category = await request(app.getHttpServer()).post(ownerPath("categories"))
      .set(owner()).send({ name: "مشروبات" });
    expect(category.status).toBe(201);
    const product = await request(app.getHttpServer()).post(ownerPath("products"))
      .set(owner()).send({ categoryId: category.body.data.id, name: "قهوة عربية", priceMinor: 1500,
        oldPriceMinor: 2000, tags: ["hot"], isVisible: true });
    expect(product.status).toBe(201);
    const menu = await request(app.getHttpServer()).get("/api/v1/public/menu/" + currency.body.data.slug);
    expect(menu.status).toBe(200);
    expect(menu.body.data.products).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: product.body.data.id, currency: "USD", priceMinor: 1500 }),
    ]));
    expect(menu.body.data).not.toHaveProperty("sessionToken");
    expect(menu.body.data).not.toHaveProperty("qrToken");

    const floor = await request(app.getHttpServer()).post(ownerPath("floors"))
      .set(owner()).send({ name: "الطابق الأول" });
    expect(floor.status).toBe(201);
    const area = await request(app.getHttpServer()).post(ownerPath("areas"))
      .set(owner()).send({ floorId: floor.body.data.id, name: "الصالة" });
    expect(area.status).toBe(201);
    const first = await request(app.getHttpServer()).post(ownerPath("tables"))
      .set(owner()).send({ areaId: area.body.data.id, label: "1" });
    const second = await request(app.getHttpServer()).post(ownerPath("tables"))
      .set(owner()).send({ areaId: area.body.data.id, label: "2" });
    expect(first.status).toBe(201); expect(second.status).toBe(201);
    tableOne = first.body.data.id; tableTwo = second.body.data.id;
    const firstQr = await request(app.getHttpServer())
      .get("/api/v1/owner/tables/" + tableOne + "/qr").set(owner());
    const secondQr = await request(app.getHttpServer())
      .get("/api/v1/owner/tables/" + tableTwo + "/qr").set(owner());
    expect(firstQr.status).toBe(200); expect(secondQr.status).toBe(200);
    qrOne = (firstQr.body.data.url as string).split("/").at(-1)!;
    qrTwo = (secondQr.body.data.url as string).split("/").at(-1)!;
    const welcome = await request(app.getHttpServer()).get("/api/v1/public/t/" + qrOne);
    expect(welcome.status).toBe(200);
    expect(welcome.body.data.callsAvailable).toBe(true);

    const session = await request(app.getHttpServer()).post("/api/v1/public/t/" + qrOne + "/sessions");
    expect(session.status).toBe(201);
    expect(session.body.data.firstCallNeedsConfirmation).toBe(true);
    const token: string = session.body.data.sessionToken, key = randomUUID();
    const requiresConfirmation = await publicCall(token, key);
    expect(requiresConfirmation.status).toBe(409);
    expect(requiresConfirmation.body.error.code).toBe("FIRST_CALL_CONFIRMATION_REQUIRED");
    const called = await publicCall(token, key, true);
    expect(called.status).toBe(201);
    expect(called.body.data).toMatchObject({ deliveryState: "no_staff",
      recipientsCount: 0, ownerAlerted: true });
    const replay = await publicCall(token, key);
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(called.body.data.id);
    const cooldown = await publicCall(token, randomUUID());
    expect(cooldown.status).toBe(429);
    expect(cooldown.body.error.code).toBe("COOLDOWN_ACTIVE");
    const alerts = await request(app.getHttpServer()).get("/api/v1/owner/alerts").set(owner());
    expect(alerts.status).toBe(200);
    expect(alerts.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ callId: called.body.data.id }),
    ]));
    expect((await request(app.getHttpServer()).get("/api/v1/owner/branches/" + foreignBranchId)
      .set(owner())).status).toBe(404);
    expect((await request(app.getHttpServer()).get(ownerPath("products"))
      .set(auth(foreignOwnerToken))).status).toBe(404);
    expect((await request(app.getHttpServer()).get(ownerPath("products"))
      .set(admin())).status).toBe(403);
  });

  it("routes a new QR call to an on-shift employee and only mocks Expo gateway acceptance", async () => {
    const username = unique();
    const created = await request(app.getHttpServer()).post("/api/v1/owner/employees")
      .set(owner()).send({ username, name: "النادل الأول", branchId, department: "waiter",
        initialPassword: INITIAL_STAFF });
    expect(created.status).toBe(201);
    staffId = created.body.data.id; users.push(staffId); names.push(username);
    staffToken = await changePassword(username, INITIAL_STAFF, CHANGED_STAFF);
    const shift = await request(app.getHttpServer()).post("/api/v1/employee/shifts/start")
      .set(auth(staffToken));
    expect(shift.status).toBe(201);
    const device = await request(app.getHttpServer()).post("/api/v1/employee/devices")
      .set(auth(staffToken)).send({
        expoPushToken: "ExpoPushToken[abcdefghijklmnopqrst1234567890]", platform: "android",
      });
    expect(device.status).toBe(201);
    expect(device.body.data).not.toHaveProperty("expoPushToken");

    const visit = await request(app.getHttpServer()).post("/api/v1/public/t/" + qrTwo + "/sessions");
    expect(visit.status).toBe(201);
    staffVisit = visit.body.data.sessionToken;
    const accepted = await publicCall(staffVisit, randomUUID(), true);
    expect(accepted.status).toBe(201);
    expect(accepted.body.data).toMatchObject({
      deliveryState: "queued", recipientsCount: 1, ownerAlerted: false,
    });
    const queue = await pool.query(
      "SELECT recipient_user_id,state FROM call_outbox WHERE call_id=$1", [accepted.body.data.id],
    );
    expect(queue.rows).toEqual([{ recipient_user_id: staffId, state: "pending" }]);
    const history = await request(app.getHttpServer()).get("/api/v1/employee/calls").set(auth(staffToken));
    expect(history.status).toBe(200);
    expect(history.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: accepted.body.data.id }),
    ]));
    expect((await publicCall(staffVisit, randomUUID())).status).toBe(429);
    expect((await request(app.getHttpServer()).get("/api/v1/owner/alerts")
      .set(auth(staffToken))).status).toBe(403);

    const processing = await app.get(PushDispatcherService).tick();
    expect(processing.attempts).toBe(1);
    expect(fakeSend).toHaveBeenCalledTimes(1);
    const delivery = await pool.query(
      "SELECT state,ticket_id,receipt_status FROM push_deliveries WHERE device_id=$1", [device.body.data.id],
    );
    expect(delivery.rows).toEqual([
      { state: "accepted", ticket_id: "fake-expo-ticket-e2e", receipt_status: "waiting" },
    ]);
    // An accepted provider ticket is NOT confirmed handset delivery.
    const events = await pool.query(
      "SELECT event_type,recipient_user_id FROM realtime_events WHERE restaurant_id=$1", [restaurantId],
    );
    expect(events.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: "call.created", recipient_user_id: staffId }),
      expect.objectContaining({ event_type: "call.created", recipient_user_id: null }),
    ]));
  });

  it("revokes old QR visits and blocks public operations after subscription expiry", async () => {
    const rotate = await request(app.getHttpServer())
      .post("/api/v1/owner/tables/" + tableTwo + "/qr/rotate").set(owner());
    expect(rotate.status).toBe(200);
    const newQr = (rotate.body.data.url as string).split("/").at(-1)!;
    expect(newQr).not.toBe(qrTwo);
    expect((await request(app.getHttpServer()).get("/api/v1/public/t/" + qrTwo)).status).toBe(404);
    expect((await publicCall(staffVisit, randomUUID())).status).toBe(404);
    expect((await request(app.getHttpServer()).post("/api/v1/public/t/" + newQr + "/sessions")).status)
      .toBe(201);

    await pool.query(
      "UPDATE subscriptions SET starts_at=now()-interval '60 days', ends_at=now()-interval '30 days', grace_ends_at=now()-interval '30 days' WHERE id=$1",
      [subscriptionId],
    );
    const renewal = await request(app.getHttpServer()).get("/api/v1/owner/subscription").set(owner());
    expect(renewal.status).toBe(200);
    expect(renewal.body.data.canOperate).toBe(false);
    expect(renewal.body.data.subscription.effectiveStatus).toBe("expired");
    expect((await request(app.getHttpServer()).get("/api/v1/owner/branches/" + branchId)
      .set(owner())).status).toBe(403);
    const slug = (await pool.query("SELECT slug FROM branches WHERE id=$1", [branchId])).rows[0].slug;
    expect((await request(app.getHttpServer()).get("/api/v1/public/menu/" + slug)).status).toBe(403);
    expect((await request(app.getHttpServer()).post("/api/v1/public/t/" + newQr + "/sessions")).status)
      .toBe(403);
    const audit = await request(app.getHttpServer())
      .get("/api/v1/admin/audit-logs?restaurantId=" + restaurantId).set(admin());
    expect(audit.status).toBe(200);
    expect(audit.body.data.length).toBeGreaterThan(0);
    expect(audit.body.data[0]).not.toHaveProperty("metadata");
  });
});
