import { createHash, randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { firstValueFrom, filter } from "rxjs";
import { PUSH_GATEWAY, type PushGateway } from "../../src/modules/push/infrastructure/expo-push.gateway";
import { PushDispatcherService } from "../../src/modules/push/application/push-dispatcher.service";
import { RealtimeService } from "../../src/modules/realtime/application/realtime.service";
import { AuthService } from "../../src/modules/auth";
import { AppModule } from "../../src/app.module";
import { configureHttpApp } from "../../src/bootstrap";
import { hashPassword } from "../../src/common/crypto/password";
import { visitHash } from "../../src/common/calls/visit-policy";

const ADMIN = "CallIntegrationAdminPassword_2026!";
const INITIAL = "CallIntegrationOwnerPassword_2026!";
const CHANGED = "CallIntegrationOwnerChanged_2026!";
const STAFF = "CallIntegrationStaffInitial_2026!";
const NEW_STAFF = "CallIntegrationStaffChanged_2026!";

describe("QR sessions and shift-aware calls (PostgreSQL)", () => {
  let app: INestApplication;
  let pool: Pool;
  let adminToken = "", ownerToken = "", employeeToken = "", platformToken = "";
  let restaurantId = "", branchId = "", tableId = "", qrToken = "", visitToken = "";
  let employeeId = "", otherBranchId = "";
  const gateway: PushGateway = {
    send: jest.fn(async () => ({ ok: true as const, id: "integration-expo-ticket" })),
    receipts: jest.fn(async (ids: readonly string[]) => Object.fromEntries(
      ids.map(id => [id, { status: "ok" as const }]))),
  };
  const users: string[] = [], names: string[] = [];
  const restaurantIds: string[] = [], branchIds: string[] = [], planIds: string[] = [], subscriptionIds: string[] = [];
  const unique = () => "calltest_" + randomUUID().replaceAll("-", "");
  const auth = (token: string) => ({ Authorization: "Bearer " + token });
  const owner = () => auth(ownerToken);
  const admin = () => auth(adminToken);
  const branch = (name: string) => "/api/v1/owner/branches/" + branchId + "/" + name;
  const publicCall = (key: string, confirmFirstCall = false, type: "waiter" | "hookah" = "waiter",
    token = visitToken) => request(app.getHttpServer()).post("/api/v1/public/calls")
    .send({ sessionToken: token, idempotencyKey: key, type, confirmFirstCall });

  async function setPassword(username: string, first: string, second: string): Promise<string> {
    const login = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username, password: first, client: "mobile" });
    expect(login.status).toBe(200);
    const changed = await request(app.getHttpServer()).post("/api/v1/auth/change-password")
      .set(auth(login.body.data.accessToken)).send({ currentPassword: first, newPassword: second });
    expect(changed.status).toBe(200);
    const relogin = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username, password: second, client: "mobile" });
    expect(relogin.status).toBe(200);
    return relogin.body.data.accessToken as string;
  }

  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") throw new Error("Use isolated test DB");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PUSH_GATEWAY).useValue(gateway).compile();
    app = module.createNestApplication(); configureHttpApp(app); await app.init();
    const adminName = unique(), adminId = randomUUID();
    users.push(adminId); names.push(adminName);
    await pool.query(`INSERT INTO users (id,username,display_name,password_hash,role,must_change_password)
      VALUES ($1,$2,'Call Admin',$3,'PRIMARY_ADMIN',false)`, [adminId, adminName, await hashPassword(ADMIN)]);
    const login = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username: adminName, password: ADMIN, client: "mobile" });
    expect(login.status).toBe(200); adminToken = login.body.data.accessToken;
    const platformName = unique(), platformId = randomUUID();
    users.push(platformId); names.push(platformName);
    await pool.query(`INSERT INTO users (id,username,display_name,password_hash,role,must_change_password)
      VALUES ($1,$2,'Call Platform Admin',$3,'PLATFORM_ADMIN',false)`,
      [platformId, platformName, await hashPassword(ADMIN)]);
    const platformLogin = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username: platformName, password: ADMIN, client: "mobile" });
    expect(platformLogin.status).toBe(200);
    platformToken = platformLogin.body.data.accessToken;
    const username = unique();
    const restaurant = await request(app.getHttpServer()).post("/api/v1/admin/restaurants").set(admin())
      .send({ name: "Call Test Restaurant", owner: { name: "Owner", username, initialPassword: INITIAL },
        initialBranch: { name: "Main" } });
    expect(restaurant.status).toBe(201);
    restaurantId = restaurant.body.data.id; branchId = restaurant.body.data.branchId;
    restaurantIds.push(restaurantId); branchIds.push(branchId);
    users.push(restaurant.body.data.ownerId); names.push(username);
    const otherUsername = unique();
    const otherRestaurant = await request(app.getHttpServer()).post("/api/v1/admin/restaurants")
      .set(admin()).send({ name: "Other Analytics Tenant",
        owner: { name: "Other Owner", username: otherUsername, initialPassword: INITIAL },
        initialBranch: { name: "Other Main" } });
    expect(otherRestaurant.status).toBe(201);
    otherBranchId = otherRestaurant.body.data.branchId;
    restaurantIds.push(otherRestaurant.body.data.id);
    branchIds.push(otherBranchId);
    users.push(otherRestaurant.body.data.ownerId); names.push(otherUsername);
    const plan = await request(app.getHttpServer()).post("/api/v1/admin/plans").set(admin()).send({
      name: unique(), maxBranches: 2, maxTables: 10, maxEmployees: 1,
      features: { menu: true, waiter_calls: true, hookah_calls: true, analytics: true },
    });
    expect(plan.status).toBe(201); planIds.push(plan.body.data.id);
    const pending = await request(app.getHttpServer()).post("/api/v1/admin/restaurants/" +
      restaurantId + "/subscriptions").set(admin()).send({ planId: plan.body.data.id, period: "monthly" });
    expect(pending.status).toBe(201); subscriptionIds.push(pending.body.data.id);
    const active = await request(app.getHttpServer()).post("/api/v1/admin/subscriptions/" +
      pending.body.data.id + "/activate").set(admin()).send({ graceDays: 0 });
    expect(active.status).toBe(200);
    ownerToken = await setPassword(username, INITIAL, CHANGED);
    const floor = await request(app.getHttpServer()).post(branch("floors")).set(owner()).send({ name: "Ground" });
    expect(floor.status).toBe(201);
    const area = await request(app.getHttpServer()).post(branch("areas")).set(owner())
      .send({ floorId: floor.body.data.id, name: "Inside" });
    expect(area.status).toBe(201);
    const table = await request(app.getHttpServer()).post(branch("tables")).set(owner())
      .send({ areaId: area.body.data.id, label: "Table one" });
    expect(table.status).toBe(201); tableId = table.body.data.id;
    const qr = await request(app.getHttpServer()).get("/api/v1/owner/tables/" + tableId + "/qr").set(owner());
    expect(qr.status).toBe(200); qrToken = (qr.body.data.url as string).split("/").at(-1)!;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (!pool) return;
    await pool.query("DELETE FROM push_deliveries WHERE outbox_id IN (SELECT id FROM call_outbox WHERE call_id IN (SELECT id FROM service_calls WHERE restaurant_id=ANY($1::uuid[])))", [restaurantIds]);
    await pool.query("DELETE FROM employee_push_devices WHERE user_id=ANY($1::uuid[])", [users]);
    await pool.query("DELETE FROM realtime_events WHERE restaurant_id=ANY($1::uuid[])", [restaurantIds]);
    await pool.query("DELETE FROM restaurant_event_counters WHERE restaurant_id=ANY($1::uuid[])", [restaurantIds]);
    await pool.query("DELETE FROM call_outbox WHERE call_id IN (SELECT id FROM service_calls WHERE restaurant_id=ANY($1::uuid[]))", [restaurantIds]);
    await pool.query("DELETE FROM owner_alerts WHERE restaurant_id=ANY($1::uuid[])", [restaurantIds]);
    await pool.query("DELETE FROM service_calls WHERE restaurant_id=ANY($1::uuid[])", [restaurantIds]);
    await pool.query("DELETE FROM visit_sessions WHERE restaurant_id=ANY($1::uuid[])", [restaurantIds]);
    await pool.query("DELETE FROM employee_shifts WHERE restaurant_id=ANY($1::uuid[])", [restaurantIds]);
    await pool.query("DELETE FROM branch_call_settings WHERE branch_id=ANY($1::uuid[])", [branchIds]);
    await pool.query("DELETE FROM restaurant_call_settings WHERE restaurant_id=ANY($1::uuid[])", [restaurantIds]);
    await pool.query("DELETE FROM qr_credentials WHERE branch_id=ANY($1::uuid[])", [branchIds]);
    await pool.query("DELETE FROM restaurant_tables WHERE branch_id=ANY($1::uuid[])", [branchIds]);
    await pool.query("DELETE FROM areas WHERE branch_id=ANY($1::uuid[])", [branchIds]);
    await pool.query("DELETE FROM floors WHERE branch_id=ANY($1::uuid[])", [branchIds]);
    await pool.query("DELETE FROM subscription_terms WHERE subscription_id=ANY($1::uuid[])", [subscriptionIds]);
    await pool.query("DELETE FROM audit_logs WHERE restaurant_id=ANY($1::uuid[]) OR actor_user_id=ANY($2::uuid[])", [restaurantIds,users]);
    await pool.query("DELETE FROM subscriptions WHERE id=ANY($1::uuid[])", [subscriptionIds]);
    await pool.query("DELETE FROM auth_sessions WHERE user_id=ANY($1::uuid[])", [users]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
    await pool.query("DELETE FROM branches WHERE id=ANY($1::uuid[])", [branchIds]);
    await pool.query("DELETE FROM restaurants WHERE id=ANY($1::uuid[])", [restaurantIds]);
    await pool.query("DELETE FROM plans WHERE id=ANY($1::uuid[])", [planIds]);
    for (const name of names) await pool.query("DELETE FROM auth_login_attempts WHERE identity_hash=$1",
      [createHash("sha256").update(name.toLowerCase()).digest("hex")]);
    await pool.end();
  });

  it("starts a 4h visit without QR leakage and requires first-call confirmation", async () => {
    const context = await request(app.getHttpServer()).get("/api/v1/public/t/" + qrToken);
    expect(context.status).toBe(200);
    expect(context.body.data.callsAvailable).toBe(true);
    const session = await request(app.getHttpServer()).post("/api/v1/public/t/" + qrToken + "/sessions");
    expect(session.status).toBe(201);
    expect(session.body.data.availableCallTypes).toEqual(["waiter"]);
    expect(session.body.data.firstCallNeedsConfirmation).toBe(true);
    visitToken = session.body.data.sessionToken;
    const stored = await pool.query("SELECT token_hash FROM visit_sessions WHERE token_hash=$1",
      [visitHash(visitToken)]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].token_hash).not.toBe(visitToken);
    const rejected = await publicCall(randomUUID());
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe("FIRST_CALL_CONFIRMATION_REQUIRED");
    const idem = randomUUID();
    const accepted = await publicCall(idem, true);
    expect(accepted.status).toBe(201);
    expect(accepted.body.data).toMatchObject({
      deliveryState: "no_staff", recipientsCount: 0, ownerAlerted: true,
    });
    const retry = await publicCall(idem);
    expect(retry.status).toBe(201);
    expect(retry.body.data.id).toBe(accepted.body.data.id);
    const cooldown = await publicCall(randomUUID());
    expect(cooldown.status).toBe(429);
    expect(cooldown.body.error.code).toBe("COOLDOWN_ACTIVE");
    const alerts = await request(app.getHttpServer()).get("/api/v1/owner/alerts").set(owner());
    expect(alerts.status).toBe(200);
    expect(alerts.body.data).toHaveLength(1);
  });

  it("creates employees with quota, starts shift, and saves pending outbox without claiming push delivery", async () => {
    const username = unique();
    const created = await request(app.getHttpServer()).post("/api/v1/owner/employees")
      .set(owner()).send({ username, name: "Waiter One", branchId, department: "waiter",
        initialPassword: STAFF });
    expect(created.status).toBe(201);
    employeeId = created.body.data.id;
    users.push(employeeId); names.push(username);
    expect(created.body.data).not.toHaveProperty("password_hash");
    employeeToken = await setPassword(username, STAFF, NEW_STAFF);
    const quota = await request(app.getHttpServer()).post("/api/v1/owner/employees")
      .set(owner()).send({ username: unique(), name: "Waiter Two", branchId, department: "waiter",
        initialPassword: STAFF });
    expect(quota.status).toBe(403);
    expect(quota.body.error.code).toBe("PLAN_LIMIT_REACHED");
    const shift = await request(app.getHttpServer()).post("/api/v1/employee/shifts/start")
      .set(auth(employeeToken));
    expect(shift.status).toBe(201);
    const duplicate = await request(app.getHttpServer()).post("/api/v1/employee/shifts/start")
      .set(auth(employeeToken));
    expect(duplicate.status).toBe(409);
    await pool.query("UPDATE service_calls SET created_at=now()-interval '12 seconds' WHERE restaurant_id=$1",
      [restaurantId]);
    const accepted = await publicCall(randomUUID());
    expect(accepted.status).toBe(201);
    expect(accepted.body.data).toMatchObject({ deliveryState: "queued", recipientsCount: 1,
      ownerAlerted: false });
    const outbox = await pool.query("SELECT recipient_user_id,state FROM call_outbox WHERE call_id=$1",
      [accepted.body.data.id]);
    expect(outbox.rows).toEqual([{ recipient_user_id: employeeId, state: "pending" }]);
    const staffCalls = await request(app.getHttpServer()).get("/api/v1/employee/calls")
      .set(auth(employeeToken));
    expect(staffCalls.status).toBe(200);
    expect(staffCalls.body.data).toHaveLength(1);
  });

  it("registers encrypted device; dispatches with Expo ticket semantics and exposes tenant/recipient SSE only", async () => {
    const token = "ExpoPushToken[abcdefghijklmnopqrst1234567890]";
    expect((await request(app.getHttpServer()).post("/api/v1/employee/devices").set(owner())
      .send({ expoPushToken: token, platform: "android" })).status).toBe(403);
    const invalid = await request(app.getHttpServer()).post("/api/v1/employee/devices")
      .set(auth(employeeToken)).send({ expoPushToken: "bad", platform: "android" });
    expect(invalid.status).toBe(400);
    const device = await request(app.getHttpServer()).post("/api/v1/employee/devices")
      .set(auth(employeeToken)).send({ expoPushToken: token, platform: "android" });
    expect(device.status).toBe(201);
    const deviceId = device.body.data.id as string;
    expect(device.body.data).not.toHaveProperty("expoPushToken");
    expect(device.body.data).not.toHaveProperty("token_box");
    const again = await request(app.getHttpServer()).post("/api/v1/employee/devices")
      .set(auth(employeeToken)).send({ expoPushToken: token, platform: "android" });
    expect(again.status).toBe(201);
    expect(again.body.data.id).toBe(deviceId);
    const stored = await pool.query("SELECT token_box,token_hash FROM employee_push_devices WHERE id=$1", [deviceId]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].token_box).not.toContain(token);
    expect(stored.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    const devices = await request(app.getHttpServer()).get("/api/v1/employee/devices").set(auth(employeeToken));
    expect(devices.status).toBe(200);
    expect(devices.body.data).toHaveLength(1);

    const worker = app.get(PushDispatcherService);
    const run = await worker.tick(); // Fake Expo gateway only; zero outbound traffic.
    expect(run.attempts).toBe(1);
    expect(gateway.send).toHaveBeenCalledTimes(1);
    const delivered = await pool.query("SELECT state,ticket_id,receipt_status FROM push_deliveries WHERE device_id=$1",
      [deviceId]);
    expect(delivered.rows).toEqual([{ state: "accepted", ticket_id: "integration-expo-ticket",
      receipt_status: "waiting" }]);
    const outbox = await pool.query("SELECT state FROM call_outbox WHERE recipient_user_id=$1", [employeeId]);
    expect(outbox.rows[0].state).toBe("sent");
    await pool.query("UPDATE push_deliveries SET next_attempt_at=now()-interval '1 second' WHERE device_id=$1", [deviceId]);
    const checked = await worker.tick();
    expect(checked.receipts).toBe(1);
    const receipt = await pool.query("SELECT receipt_status FROM push_deliveries WHERE device_id=$1", [deviceId]);
    expect(receipt.rows[0].receipt_status).toBe("ok");

    const authService = app.get(AuthService);
    const realtime = app.get(RealtimeService);
    const ownerPrincipal = await authService.authenticate(ownerToken);
    const staffPrincipal = await authService.authenticate(employeeToken);
    const ownerEvent = await firstValueFrom(realtime.stream(ownerPrincipal, ownerToken, 0)
      .pipe(filter(event => event.type === "call.created")));
    const employeeEvent = await firstValueFrom(realtime.stream(staffPrincipal, employeeToken, 0)
      .pipe(filter(event => event.type === "call.created")));
    expect(ownerEvent.type).toBe("call.created");
    expect(employeeEvent.type).toBe("call.created");
    expect(ownerEvent.data).toMatchObject({ branchId, eventType: "call.created" });
    expect(employeeEvent.data).toMatchObject({ branchId, eventType: "call.created" });
    expect(employeeEvent.data).not.toHaveProperty("sessionToken");
    const separated = await pool.query(`SELECT recipient_user_id,event_type FROM realtime_events
      WHERE restaurant_id=$1 ORDER BY sequence`, [restaurantId]);
    expect(separated.rows.some(r => r.recipient_user_id === null && r.event_type === "call.created")).toBe(true);
    expect(separated.rows.some(r => r.recipient_user_id === employeeId && r.event_type === "call.created")).toBe(true);
    expect((await request(app.getHttpServer()).get("/api/v1/owner/events")
      .set(auth(employeeToken))).status).toBe(403);
    expect((await request(app.getHttpServer()).get("/api/v1/employee/events")
      .set(owner())).status).toBe(403);

    const unregistered = await request(app.getHttpServer()).delete("/api/v1/employee/devices/" + deviceId)
      .set(auth(employeeToken));
    expect(unregistered.status).toBe(200);
    expect(unregistered.body.data.unregistered).toBe(true);
    const listAfter = await request(app.getHttpServer()).get("/api/v1/employee/devices")
      .set(auth(employeeToken));
    expect(listAfter.body.data).toEqual([]);
  });

  it("supports branch override, disables types and respects QR rotation and session expiry", async () => {
    const disable = await request(app.getHttpServer()).patch(branch("call-settings"))
      .set(owner()).send({ enabled: false });
    expect(disable.status).toBe(200);
    const denied = await publicCall(randomUUID());
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("CALLS_DISABLED");
    const enable = await request(app.getHttpServer()).patch(branch("call-settings"))
      .set(owner()).send({ enabled: null, hookahEnabled: true, routingMode: "department_on_shift" });
    expect(enable.status).toBe(200);
    expect(enable.body.data).toMatchObject({ enabled: true, hookahEnabled: true,
      routingMode: "department_on_shift" });
    const hookah = await publicCall(randomUUID(), false, "hookah");
    expect(hookah.status).toBe(201);
    expect(hookah.body.data).toMatchObject({ deliveryState: "no_staff", recipientsCount: 0 });
    const rotated = await request(app.getHttpServer()).post("/api/v1/owner/tables/" + tableId + "/qr/rotate")
      .set(owner());
    expect(rotated.status).toBe(200);
    expect((await request(app.getHttpServer()).post("/api/v1/public/t/" + qrToken + "/sessions")).status)
      .toBe(404);
    expect((await publicCall(randomUUID())).status).toBe(404);
    qrToken = (rotated.body.data.url as string).split("/").at(-1)!;
    const fresh = await request(app.getHttpServer()).post("/api/v1/public/t/" + qrToken + "/sessions");
    expect(fresh.status).toBe(201);
    visitToken = fresh.body.data.sessionToken;
    await pool.query("UPDATE visit_sessions SET created_at=now()-interval '5 hours', last_activity_at=now()-interval '5 hours', expires_at=now()-interval '1 second' WHERE token_hash=$1",
      [visitHash(visitToken)]);
    const expired = await publicCall(randomUUID(), true);
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe("SESSION_EXPIRED");
  });

  it("reports tenant-only UTC aggregates, zero days and plan-safe bounded ranges", async () => {
    const today = new Date();
    const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const date = (day: number) => new Date(midnight + day * 86_400_000).toISOString().slice(0, 10);
    const report = await request(app.getHttpServer())
      .get("/api/v1/owner/call-analytics?from=" + date(-1) + "&to=" + date(1))
      .set(owner());
    expect(report.status).toBe(200);
    expect(report.body.data).toMatchObject({ from: date(-1), to: date(1), branchId: null,
      summary: { totalCalls: 3, waiterCalls: 2, hookahCalls: 1,
        noStaffCalls: 2, routedCalls: 1, distinctTables: 1 } });
    expect(report.body.data.daily).toHaveLength(2);
    expect(report.body.data.daily.reduce((acc: number, day: { totalCalls: number }) =>
      acc + day.totalCalls, 0)).toBe(3);

    const byBranch = await request(app.getHttpServer())
      .get("/api/v1/owner/call-analytics?branchId=" + branchId + "&from=" + date(-1) + "&to=" + date(1))
      .set(owner());
    expect(byBranch.status).toBe(200);
    expect(byBranch.body.data.summary.totalCalls).toBe(3);
    expect(byBranch.body.data.branchId).toBe(branchId);
    const future = await request(app.getHttpServer()).get("/api/v1/owner/call-analytics?from=" +
      date(4) + "&to=" + date(6)).set(owner());
    expect(future.status).toBe(200);
    expect(future.body.data.summary.totalCalls).toBe(0);
    expect(future.body.data.daily.map((x: { totalCalls: number }) => x.totalCalls)).toEqual([0,0]);
    const foreignBranch = await request(app.getHttpServer())
      .get("/api/v1/owner/call-analytics?branchId=" + otherBranchId).set(owner());
    expect(foreignBranch.status).toBe(404);
    const invalid = await request(app.getHttpServer())
      .get("/api/v1/owner/call-analytics?from=2026-02-30&to=2026-03-01").set(owner());
    expect(invalid.status).toBe(400);
    const tooLong = await request(app.getHttpServer())
      .get("/api/v1/owner/call-analytics?from=2026-01-01&to=2026-05-01").set(owner());
    expect(tooLong.status).toBe(400);
    const incomplete = await request(app.getHttpServer())
      .get("/api/v1/owner/call-analytics?from=2026-01-01").set(owner());
    expect(incomplete.status).toBe(400);
    expect((await request(app.getHttpServer())
      .get("/api/v1/owner/call-analytics").set(auth(employeeToken))).status).toBe(403);
    expect((await request(app.getHttpServer())
      .get("/api/v1/owner/call-analytics")).status).toBe(401);
  });

  it("enforces owner role and documents public/staff APIs", async () => {
    const denied = await request(app.getHttpServer()).get("/api/v1/owner/employees")
      .set(auth(employeeToken));
    expect(denied.status).toBe(403);
    const history = await request(app.getHttpServer()).get("/api/v1/owner/calls?limit=1")
      .set(owner());
    expect(history.status).toBe(200);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.meta.hasMore).toBe(true);
    const schema = await request(app.getHttpServer()).get("/api/docs-json");
    expect(schema.status).toBe(200);
    expect(schema.body.paths["/api/v1/public/calls"].post).toBeDefined();
    expect(schema.body.paths["/api/v1/public/t/{qrToken}/sessions"].post).toBeDefined();
    expect(schema.body.paths["/api/v1/employee/shifts/start"].post).toBeDefined();
  });
});
