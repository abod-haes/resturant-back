import { createHash, randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { configureHttpApp } from "../../src/bootstrap";
import { hashPassword } from "../../src/common/crypto/password";
import { hashOpaqueToken } from "../../src/common/crypto/opaque-token";

const PASSWORD = "QrVisitsTestInitialPassword_2026!";
const CHANGED = "QrVisitsTestChangedPassword_2026!";
const features = { menu: true, waiter_calls: true, hookah_calls: true, analytics: false };

describe("QR visits, staff shifts, idempotent calls and owner fallback (PostgreSQL)", () => {
  let app: INestApplication;
  let pool: Pool;
  let adminToken = "";
  let ownerToken = "";
  let otherOwnerToken = "";
  let restaurantId = "";
  let branchId = "";
  let tableId = "";
  let qrToken = "";
  let visitToken = "";
  let waiterToken = "";
  let hookahToken = "";
  let waiterShiftId = "";
  let hookahShiftId = "";
  let waiterId = "";
  let hookahId = "";
  const restaurantIds: string[] = [];
  const branchIds: string[] = [];
  const userIds: string[] = [];
  const usernames: string[] = [];
  const planIds: string[] = [];
  const subscriptionIds: string[] = [];
  const unique = () => "visit_" + randomUUID().replaceAll("-", "");
  const auth = (token: string) => ({ Authorization: "Bearer " + token });
  const owner = () => auth(ownerToken);
  const admin = () => auth(adminToken);
  const uuid = () => randomUUID();
  const route = (resource: string) => "/api/v1/owner/branches/" + branchId + "/" + resource;
  const call = (token: string, type: "waiter" | "hookah", key = uuid(), confirmed = true) =>
    request(app.getHttpServer()).post("/api/v1/public/calls")
      .send({ sessionToken: token, type, idempotencyKey: key, firstCallConfirmed: confirmed });

  async function login(username: string, initial = PASSWORD): Promise<string> {
    const result = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username, password: initial, client: "mobile" });
    expect(result.status).toBe(200);
    return result.body.data.accessToken as string;
  }

  async function provisionRestaurant() {
    const username = unique();
    const response = await request(app.getHttpServer()).post("/api/v1/admin/restaurants")
      .set(admin()).send({ name: "Visit Test Restaurant",
        owner: { name: "Visit Owner", username, initialPassword: PASSWORD },
        initialBranch: { name: "Main" } });
    expect(response.status).toBe(201);
    const { id, branchId: bId, ownerId } = response.body.data;
    restaurantIds.push(id); branchIds.push(bId); userIds.push(ownerId); usernames.push(username);
    const plan = await request(app.getHttpServer()).post("/api/v1/admin/plans").set(admin())
      .send({ name: unique(), maxBranches: 2, maxTables: 3, maxEmployees: 2, features });
    expect(plan.status).toBe(201);
    planIds.push(plan.body.data.id);
    const pending = await request(app.getHttpServer())
      .post("/api/v1/admin/restaurants/" + id + "/subscriptions").set(admin())
      .send({ planId: plan.body.data.id, period: "monthly" });
    expect(pending.status).toBe(201);
    subscriptionIds.push(pending.body.data.id);
    const activated = await request(app.getHttpServer())
      .post("/api/v1/admin/subscriptions/" + pending.body.data.id + "/activate").set(admin())
      .send({ graceDays: 3 });
    expect(activated.status).toBe(200);
    const token = await login(username);
    const changed = await request(app.getHttpServer()).post("/api/v1/auth/change-password")
      .set(auth(token)).send({ currentPassword: PASSWORD, newPassword: CHANGED });
    expect(changed.status).toBe(200);
    return { id: id as string, branchId: bId as string, ownerToken: await login(username, CHANGED) };
  }

  async function createEmployee(username: string, department: "waiter" | "hookah") {
    const response = await request(app.getHttpServer()).post(route("employees"))
      .set(owner()).send({ username, displayName: username, initialPassword: PASSWORD, department });
    if (response.status === 201) { userIds.push(response.body.data.id); usernames.push(username); }
    return response;
  }

  async function staffLogin(username: string) {
    const first = await login(username);
    const change = await request(app.getHttpServer()).post("/api/v1/auth/change-password")
      .set(auth(first)).send({ currentPassword: PASSWORD, newPassword: CHANGED });
    expect(change.status).toBe(200);
    return login(username, CHANGED);
  }

  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") throw new Error("Use isolated PostgreSQL testing only");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureHttpApp(app);
    await app.init();
    const adminName = unique();
    const adminId = uuid();
    usernames.push(adminName); userIds.push(adminId);
    await pool.query(
      `INSERT INTO users(id,username,display_name,password_hash,role,must_change_password)
       VALUES($1,$2,'Visit Admin',$3,'PRIMARY_ADMIN',false)`,
      [adminId, adminName, await hashPassword(PASSWORD)]);
    adminToken = await login(adminName);
    const a = await provisionRestaurant();
    const b = await provisionRestaurant();
    restaurantId = a.id; branchId = a.branchId; ownerToken = a.ownerToken;
    otherOwnerToken = b.ownerToken;
    const floor = await request(app.getHttpServer()).post(route("floors"))
      .set(owner()).send({ name: "Ground" });
    expect(floor.status).toBe(201);
    const area = await request(app.getHttpServer()).post(route("areas"))
      .set(owner()).send({ floorId: floor.body.data.id, name: "Hall" });
    expect(area.status).toBe(201);
    const table = await request(app.getHttpServer()).post(route("tables"))
      .set(owner()).send({ areaId: area.body.data.id, label: "T1" });
    expect(table.status).toBe(201);
    tableId = table.body.data.id;
    const qr = await request(app.getHttpServer()).get("/api/v1/owner/tables/" + tableId + "/qr").set(owner());
    expect(qr.status).toBe(200);
    qrToken = (qr.body.data.url as string).split("/").at(-1)!;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (!pool) return;
    await pool.query("DELETE FROM call_delivery_outbox WHERE call_id IN (SELECT id FROM service_calls WHERE restaurant_id = ANY($1::uuid[]))", [restaurantIds]);
    await pool.query("DELETE FROM call_recipients WHERE call_id IN (SELECT id FROM service_calls WHERE restaurant_id = ANY($1::uuid[]))", [restaurantIds]);
    await pool.query("DELETE FROM owner_alerts WHERE restaurant_id = ANY($1::uuid[])", [restaurantIds]);
    await pool.query("DELETE FROM service_calls WHERE restaurant_id = ANY($1::uuid[])", [restaurantIds]);
    await pool.query("DELETE FROM visit_sessions WHERE restaurant_id = ANY($1::uuid[])", [restaurantIds]);
    await pool.query("DELETE FROM employee_shifts WHERE restaurant_id = ANY($1::uuid[])", [restaurantIds]);
    await pool.query("DELETE FROM branch_call_settings WHERE branch_id = ANY($1::uuid[])", [branchIds]);
    await pool.query("DELETE FROM restaurant_call_settings WHERE restaurant_id = ANY($1::uuid[])", [restaurantIds]);
    await pool.query("DELETE FROM qr_credentials WHERE branch_id = ANY($1::uuid[])", [branchIds]);
    await pool.query("DELETE FROM restaurant_tables WHERE branch_id = ANY($1::uuid[])", [branchIds]);
    await pool.query("DELETE FROM areas WHERE branch_id = ANY($1::uuid[])", [branchIds]);
    await pool.query("DELETE FROM floors WHERE branch_id = ANY($1::uuid[])", [branchIds]);
    await pool.query("DELETE FROM subscription_terms WHERE subscription_id = ANY($1::uuid[])", [subscriptionIds]);
    await pool.query("DELETE FROM audit_logs WHERE restaurant_id = ANY($1::uuid[]) OR actor_user_id = ANY($2::uuid[])", [restaurantIds, userIds]);
    await pool.query("DELETE FROM subscriptions WHERE id = ANY($1::uuid[])", [subscriptionIds]);
    await pool.query("DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])", [userIds]);
    await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
    await pool.query("DELETE FROM branches WHERE id = ANY($1::uuid[])", [branchIds]);
    await pool.query("DELETE FROM restaurants WHERE id = ANY($1::uuid[])", [restaurantIds]);
    await pool.query("DELETE FROM plans WHERE id = ANY($1::uuid[])", [planIds]);
    for (const name of usernames) {
      await pool.query("DELETE FROM auth_login_attempts WHERE identity_hash=$1",
        [createHash("sha256").update(name.toLowerCase()).digest("hex")]);
    }
    await pool.end();
  });

  it("issues a 4-hour idle session, heartbeats it, and stores no plaintext token", async () => {
    const session = await request(app.getHttpServer()).post("/api/v1/public/t/" + qrToken + "/sessions");
    expect(session.status).toBe(201);
    visitToken = session.body.data.sessionToken;
    expect(visitToken).toMatch(/^[\w-]{43}$/);
    expect(session.body.data).toMatchObject({
      firstCallNeedsConfirmation: true, availableCallTypes: ["waiter","hookah"],
    });
    const expiresAt = new Date(session.body.data.expiresAt).getTime();
    expect(expiresAt - Date.now()).toBeGreaterThan(3 * 60 * 60 * 1000);
    const dbRow = await pool.query("SELECT token_hash FROM visit_sessions WHERE token_hash=$1",
      [hashOpaqueToken(visitToken)]);
    expect(dbRow.rows).toHaveLength(1);
    expect(dbRow.rows[0].token_hash).not.toBe(visitToken);
    const heartbeat = await request(app.getHttpServer()).post("/api/v1/public/sessions/heartbeat")
      .send({ sessionToken: visitToken });
    expect(heartbeat.status).toBe(200);
    expect(heartbeat.body.data.firstCallNeedsConfirmation).toBe(true);
    expect(new Date(heartbeat.body.data.expiresAt).getTime()).toBeGreaterThanOrEqual(expiresAt);
    expect((await request(app.getHttpServer()).post("/api/v1/public/sessions/heartbeat")
      .send({ sessionToken: "invalid" })).status).toBe(400);
  });

  it("requires first-call confirmation and persists a no-staff alert without pretending delivery", async () => {
    const missing = await call(visitToken, "waiter", uuid(), false);
    expect(missing.status).toBe(409);
    expect(missing.body.error.code).toBe("FIRST_CALL_CONFIRMATION_REQUIRED");
    const key = uuid();
    const first = await call(visitToken, "waiter", key);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ type: "waiter", deliveryState: "no_staff", ownerAlerted: true });
    const replay = await call(visitToken, "waiter", key);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(first.body.data);
    const reused = await call(visitToken, "hookah", key);
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    const throttle = await call(visitToken, "waiter");
    expect(throttle.status).toBe(429);
    expect(throttle.body.error.code).toBe("COOLDOWN_ACTIVE");
    expect(throttle.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    const hookah = await call(visitToken, "hookah");
    expect(hookah.status).toBe(200);
    expect(hookah.body.data.deliveryState).toBe("no_staff");
    const alerts = await request(app.getHttpServer()).get("/api/v1/owner/alerts")
      .set(owner());
    expect(alerts.status).toBe(200);
    expect(alerts.body.data).toHaveLength(2);
    const marked = await request(app.getHttpServer())
      .post("/api/v1/owner/alerts/" + alerts.body.data[0].id + "/read").set(owner());
    expect(marked.status).toBe(200);
    expect(marked.body.data.readAt).not.toBeNull();
    const outbox = await pool.query("SELECT count(*)::int AS count FROM call_delivery_outbox");
    expect(outbox.rows[0].count).toBe(0);
    const state = await request(app.getHttpServer()).post("/api/v1/public/sessions/heartbeat")
      .send({ sessionToken: visitToken });
    expect(state.body.data.firstCallNeedsConfirmation).toBe(false);
    const stranger = await request(app.getHttpServer()).get("/api/v1/owner/alerts")
      .set(auth(otherOwnerToken));
    expect(stranger.status).toBe(200);
    expect(stranger.body.data).toEqual([]);
  });

  it("creates employee accounts under tenant quota and enforces password change before shifts", async () => {
    const waiterName = unique();
    const hookahName = unique();
    const a = await createEmployee(waiterName, "waiter");
    const b = await createEmployee(hookahName, "hookah");
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    waiterId = a.body.data.id; hookahId = b.body.data.id;
    expect(a.body.data).not.toHaveProperty("initialPassword");
    expect(a.body.data).not.toHaveProperty("passwordHash");
    const extra = await createEmployee(unique(), "waiter");
    expect(extra.status).toBe(403);
    expect(extra.body.error.code).toBe("PLAN_LIMIT_REACHED");
    const wrongTenant = await request(app.getHttpServer()).post(route("employees"))
      .set(auth(otherOwnerToken)).send({
        username: unique(), displayName: "Wrong owner", initialPassword: PASSWORD, department: "waiter",
      });
    expect(wrongTenant.status).toBe(404);
    const raw = await login(waiterName);
    const blocked = await request(app.getHttpServer()).post("/api/v1/employee/shifts/start").set(auth(raw));
    expect(blocked.status).toBe(403);
    waiterToken = await staffLogin(waiterName);
    hookahToken = await staffLogin(hookahName);
    const startWaiter = await request(app.getHttpServer()).post("/api/v1/employee/shifts/start")
      .set(auth(waiterToken));
    const startHookah = await request(app.getHttpServer()).post("/api/v1/employee/shifts/start")
      .set(auth(hookahToken));
    expect(startWaiter.status).toBe(201);
    expect(startHookah.status).toBe(201);
    waiterShiftId = startWaiter.body.data.id;
    hookahShiftId = startHookah.body.data.id;
    expect(startWaiter.body.data.isOnShift).toBe(true);
    expect((await request(app.getHttpServer()).post("/api/v1/employee/shifts/start")
      .set(auth(waiterToken))).status).toBe(409);
    const ownerDenied = await request(app.getHttpServer()).post("/api/v1/employee/shifts/start").set(owner());
    expect(ownerDenied.status).toBe(403);
  });

  it("routes to matching on-shift employees, queues delivery records without claiming notification", async () => {
    const defaultMode = await request(app.getHttpServer()).get("/api/v1/owner/call-routing").set(owner());
    expect(defaultMode.status).toBe(200);
    expect(defaultMode.body.data.routingMode).toBe("department");
    await pool.query("UPDATE service_calls SET created_at=now() - interval '15 seconds' WHERE restaurant_id=$1", [restaurantId]);
    const session = await request(app.getHttpServer()).post("/api/v1/public/t/" + qrToken + "/sessions");
    expect(session.status).toBe(201);
    const s = session.body.data.sessionToken;
    const waiter = await call(s, "waiter");
    const hookah = await call(s, "hookah");
    expect(waiter.status).toBe(200);
    expect(hookah.status).toBe(200);
    expect(waiter.body.data.deliveryState).toBe("queued");
    expect(waiter.body.data.ownerAlerted).toBe(false);
    expect(hookah.body.data.deliveryState).toBe("queued");
    const recipients = await pool.query("SELECT call_id,employee_user_id FROM call_recipients WHERE call_id=ANY($1::uuid[])",
      [[waiter.body.data.id, hookah.body.data.id]]);
    expect(recipients.rows).toHaveLength(2);
    expect(recipients.rows.find((row) => row.call_id === waiter.body.data.id).employee_user_id).toBe(waiterId);
    expect(recipients.rows.find((row) => row.call_id === hookah.body.data.id).employee_user_id).toBe(hookahId);
    const outbox = await pool.query("SELECT state FROM call_delivery_outbox WHERE call_id=$1", [waiter.body.data.id]);
    expect(outbox.rows).toEqual([{ state: "pending" }]);
    const employeeHistory = await request(app.getHttpServer()).get("/api/v1/employee/calls")
      .set(auth(waiterToken));
    expect(employeeHistory.status).toBe(200);
    expect(employeeHistory.body.data.some((row: { id: string }) => row.id === waiter.body.data.id)).toBe(true);
    expect(employeeHistory.body.data.some((row: { id: string }) => row.id === hookah.body.data.id)).toBe(false);
  });

  it("allows owner branch override routing all staff and restores inheritance", async () => {
    const patch = await request(app.getHttpServer()).patch(route("call-routing")).set(owner())
      .send({ routingMode: "all", shiftMaxMinutes: 60 });
    expect(patch.status).toBe(200);
    expect(patch.body.data).toMatchObject({ routingMode: "all", effectiveRoutingMode: "all", shiftMaxMinutes: 60 });
    const newSession = await request(app.getHttpServer()).post("/api/v1/public/t/" + qrToken + "/sessions");
    await pool.query("UPDATE service_calls SET created_at=now() - interval '15 seconds' WHERE restaurant_id=$1", [restaurantId]);
    const created = await call(newSession.body.data.sessionToken, "waiter");
    expect(created.status).toBe(200);
    const targets = await pool.query("SELECT employee_user_id FROM call_recipients WHERE call_id=$1", [created.body.data.id]);
    expect(targets.rows.map((r) => r.employee_user_id).sort()).toEqual([waiterId, hookahId].sort());
    const reset = await request(app.getHttpServer()).patch(route("call-routing")).set(owner())
      .send({ routingMode: null });
    expect(reset.status).toBe(200);
    expect(reset.body.data).toMatchObject({ routingMode: null, effectiveRoutingMode: "department" });
  });

  it("excludes expired shifts from routing; owner can force-end without touching other tenant", async () => {
    await pool.query("UPDATE employee_shifts SET started_at=now() - interval '2 hours', planned_ends_at=now() - interval '1 hour' WHERE id=$1",
      [hookahShiftId]);
    await pool.query("UPDATE service_calls SET created_at=now() - interval '15 seconds' WHERE restaurant_id=$1", [restaurantId]);
    const newSession = await request(app.getHttpServer()).post("/api/v1/public/t/" + qrToken + "/sessions");
    const missing = await call(newSession.body.data.sessionToken, "hookah");
    expect(missing.status).toBe(200);
    expect(missing.body.data).toMatchObject({ deliveryState: "no_staff", ownerAlerted: true });
    const ownerForce = await request(app.getHttpServer())
      .post("/api/v1/owner/shifts/" + waiterShiftId + "/force-end").set(owner());
    expect(ownerForce.status).toBe(200);
    expect(ownerForce.body.data.isOnShift).toBe(false);
    const wrongOwner = await request(app.getHttpServer())
      .post("/api/v1/owner/shifts/" + hookahShiftId + "/force-end").set(auth(otherOwnerToken));
    expect(wrongOwner.status).toBe(404);
    const ended = await request(app.getHttpServer()).get("/api/v1/employee/shifts/current")
      .set(auth(waiterToken));
    expect(ended.status).toBe(200);
    expect(ended.body.data.isOnShift).toBe(false);
    const restarted = await request(app.getHttpServer()).post("/api/v1/employee/shifts/start")
      .set(auth(hookahToken));
    expect(restarted.status).toBe(201);
    expect(new Date(restarted.body.data.plannedEndsAt).getTime() - Date.now()).toBeLessThanOrEqual(60*60*1000);
  });

  it("enforces cooldown across simultaneous sessions and rejects repeated keys by type", async () => {
    await pool.query("UPDATE service_calls SET created_at=now() - interval '15 seconds' WHERE restaurant_id=$1", [restaurantId]);
    const a = await request(app.getHttpServer()).post("/api/v1/public/t/" + qrToken + "/sessions");
    const b = await request(app.getHttpServer()).post("/api/v1/public/t/" + qrToken + "/sessions");
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const [first, second] = await Promise.all([
      call(a.body.data.sessionToken, "waiter"),
      call(b.body.data.sessionToken, "waiter"),
    ]);
    expect([first.status, second.status].sort()).toEqual([200,429]);
    const success = first.status === 200 ? first : second;
    expect(["queued","no_staff"]).toContain(success.body.data.deliveryState);
    const stored = await pool.query("SELECT count(*)::int AS n FROM service_calls WHERE restaurant_id=$1 AND kind='waiter' AND created_at > now() - interval '5 seconds'",
      [restaurantId]);
    expect(stored.rows[0].n).toBe(1);
  });

  it("rejects expired visit and revoked QR, including sessions issued before rotation", async () => {
    const prior = await request(app.getHttpServer()).post("/api/v1/public/t/" + qrToken + "/sessions");
    expect(prior.status).toBe(201);
    const sessionToken = prior.body.data.sessionToken;
    await pool.query("UPDATE visit_sessions SET created_at=now() - interval '5 hours', last_activity_at=now() - interval '5 hours', expires_at=now() - interval '1 hour' WHERE token_hash=$1",
      [hashOpaqueToken(sessionToken)]);
    expect((await request(app.getHttpServer()).post("/api/v1/public/sessions/heartbeat")
      .send({ sessionToken })).status).toBe(401);
    expect((await call(sessionToken, "waiter")).status).toBe(401);
    const fresh = await request(app.getHttpServer()).post("/api/v1/public/t/" + qrToken + "/sessions");
    expect(fresh.status).toBe(201);
    const rotated = await request(app.getHttpServer()).post("/api/v1/owner/tables/" + tableId + "/qr/rotate")
      .set(owner());
    expect(rotated.status).toBe(200);
    const oldAttempt = await request(app.getHttpServer()).post("/api/v1/public/sessions/heartbeat")
      .send({ sessionToken: fresh.body.data.sessionToken });
    expect(oldAttempt.status).toBe(404);
    expect((await request(app.getHttpServer()).post("/api/v1/public/t/" + qrToken + "/sessions")).status).toBe(404);
    qrToken = rotated.body.data.url.split("/").at(-1)!;
    const newSession = await request(app.getHttpServer()).post("/api/v1/public/t/" + qrToken + "/sessions");
    expect(newSession.status).toBe(201);
  });

  it("enforces table call disable and expired subscription while keeping owner renewal status accessible", async () => {
    const disabled = await request(app.getHttpServer()).patch(route("tables") + "/" + tableId)
      .set(owner()).send({ callsEnabled: false });
    expect(disabled.status).toBe(200);
    const session = await request(app.getHttpServer()).post("/api/v1/public/t/" + qrToken + "/sessions");
    expect(session.status).toBe(201);
    const forbidden = await call(session.body.data.sessionToken, "waiter");
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("CALLS_DISABLED");
    await request(app.getHttpServer()).patch(route("tables") + "/" + tableId)
      .set(owner()).send({ callsEnabled: true });
    const snapshot = await pool.query("SELECT starts_at,ends_at,grace_ends_at FROM subscriptions WHERE id=$1",
      [subscriptionIds[0]]);
    await pool.query("UPDATE subscriptions SET starts_at=now() - interval '60 days', ends_at=now() - interval '30 days', grace_ends_at=now() - interval '25 days' WHERE id=$1",
      [subscriptionIds[0]]);
    try {
      const expired = await call(session.body.data.sessionToken, "waiter");
      expect(expired.status).toBe(403);
      expect(expired.body.error.code).toBe("SUBSCRIPTION_INACTIVE");
      expect((await request(app.getHttpServer()).get("/api/v1/owner/subscription")
        .set(owner())).status).toBe(200);
    } finally {
      const before = snapshot.rows[0];
      await pool.query("UPDATE subscriptions SET starts_at=$2,ends_at=$3,grace_ends_at=$4 WHERE id=$1",
        [subscriptionIds[0],before.starts_at,before.ends_at,before.grace_ends_at]);
    }
  });

  it("publishes correct visit and staff call paths in generated OpenAPI", async () => {
    const res = await request(app.getHttpServer()).get("/api/docs-json");
    expect(res.status).toBe(200);
    for (const p of [
      "/api/v1/public/t/{qrToken}/sessions",
      "/api/v1/public/sessions/heartbeat",
      "/api/v1/public/calls",
      "/api/v1/employee/shifts/start",
      "/api/v1/employee/calls",
      "/api/v1/owner/branches/{branchId}/employees",
      "/api/v1/owner/branches/{branchId}/call-routing",
      "/api/v1/owner/alerts",
    ]) expect(res.body.paths[p]).toBeDefined();
  });
});
