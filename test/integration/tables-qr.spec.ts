import { createHash, randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { PDFDocument } from "pdf-lib";
import { AppModule } from "../../src/app.module";
import { configureHttpApp } from "../../src/bootstrap";
import { hashPassword } from "../../src/common/crypto/password";
import { hashQrToken } from "../../src/modules/tables/domain/qr-credential";

const ADMIN_PASSWORD = "TableQrIntegrationAdmin_2026!";
const OWNER_PASSWORD = "TableQrIntegrationOwner_2026!";
const CHANGED_PASSWORD = "TableQrIntegrationChanged_2026!";
const features = { menu: true, waiter_calls: true, hookah_calls: false, analytics: false };

describe("Tables/QR: tenant, quota, rotation and printable PDF (PostgreSQL)", () => {
  let app: INestApplication;
  let pool: Pool;
  let adminToken = "";
  let ownerToken = "";
  let ownerOther = "";
  let restaurantA = "";
  let restaurantB = "";
  let branchA = "";
  let branchB = "";
  let floorId = "";
  let areaId = "";
  let tableId = "";
  let qrUrl = "";
  let firstToken = "";
  const userIds: string[] = [];
  const usernames: string[] = [];
  const restaurantIds: string[] = [];
  const branchIds: string[] = [];
  const plans: string[] = [];
  const subscriptions: string[] = [];
  const unique = () => "tables_" + randomUUID().replaceAll("-", "");
  const auth = (token: string) => ({ Authorization: "Bearer " + token });
  const admin = () => auth(adminToken);
  const owner = () => auth(ownerToken);
  const route = (collection: string) => "/api/v1/owner/branches/" + branchA + "/" + collection;

  async function provisionRestaurant() {
    const username = unique();
    const create = await request(app.getHttpServer()).post("/api/v1/admin/restaurants").set(admin())
      .send({ name: "QR Test Restaurant", owner: {
        name: "QR Owner", username, initialPassword: OWNER_PASSWORD },
        initialBranch: { name: "Main" } });
    expect(create.status).toBe(201);
    const { id, ownerId, branchId } = create.body.data;
    restaurantIds.push(id); userIds.push(ownerId); branchIds.push(branchId); usernames.push(username);
    const plan = await request(app.getHttpServer()).post("/api/v1/admin/plans").set(admin())
      .send({ name: unique(), maxBranches: 2, maxTables: 3, maxEmployees: 4, features });
    expect(plan.status).toBe(201);
    plans.push(plan.body.data.id);
    const pending = await request(app.getHttpServer())
      .post("/api/v1/admin/restaurants/" + id + "/subscriptions").set(admin())
      .send({ planId: plan.body.data.id, period: "monthly" });
    expect(pending.status).toBe(201);
    subscriptions.push(pending.body.data.id);
    const active = await request(app.getHttpServer())
      .post("/api/v1/admin/subscriptions/" + pending.body.data.id + "/activate")
      .set(admin()).send({ graceDays: 5 });
    expect(active.status).toBe(200);
    const initial = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username, password: OWNER_PASSWORD, client: "mobile" });
    expect(initial.status).toBe(200);
    const changed = await request(app.getHttpServer()).post("/api/v1/auth/change-password")
      .set(auth(initial.body.data.accessToken)).send({
        currentPassword: OWNER_PASSWORD, newPassword: CHANGED_PASSWORD,
      });
    expect(changed.status).toBe(200);
    const login = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username, password: CHANGED_PASSWORD, client: "mobile" });
    expect(login.status).toBe(200);
    return { id, branchId, token: login.body.data.accessToken as string };
  }

  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") throw new Error("Use isolated test database only");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureHttpApp(app);
    await app.init();
    const id = randomUUID();
    const username = unique();
    userIds.push(id); usernames.push(username);
    await pool.query(`INSERT INTO users(id,username,display_name,password_hash,role,must_change_password)
      VALUES($1,$2,'Tables Admin',$3,'PRIMARY_ADMIN',false)`,
    [id, username, await hashPassword(ADMIN_PASSWORD)]);
    const response = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username, password: ADMIN_PASSWORD, client: "mobile" });
    expect(response.status).toBe(200);
    adminToken = response.body.data.accessToken;
    const a = await provisionRestaurant();
    const b = await provisionRestaurant();
    restaurantA = a.id; restaurantB = b.id;
    branchA = a.branchId; branchB = b.branchId;
    ownerToken = a.token; ownerOther = b.token;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pool) {
      await pool.query("DELETE FROM qr_credentials WHERE branch_id = ANY($1::uuid[])", [branchIds]);
      await pool.query("DELETE FROM restaurant_tables WHERE branch_id = ANY($1::uuid[])", [branchIds]);
      await pool.query("DELETE FROM areas WHERE branch_id = ANY($1::uuid[])", [branchIds]);
      await pool.query("DELETE FROM floors WHERE branch_id = ANY($1::uuid[])", [branchIds]);
      await pool.query("DELETE FROM subscription_terms WHERE subscription_id = ANY($1::uuid[])", [subscriptions]);
      await pool.query("DELETE FROM audit_logs WHERE restaurant_id = ANY($1::uuid[]) OR actor_user_id = ANY($2::uuid[])", [restaurantIds, userIds]);
      await pool.query("DELETE FROM subscriptions WHERE id = ANY($1::uuid[])", [subscriptions]);
      await pool.query("DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])", [userIds]);
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
      await pool.query("DELETE FROM branches WHERE id = ANY($1::uuid[])", [branchIds]);
      await pool.query("DELETE FROM restaurants WHERE id = ANY($1::uuid[])", [restaurantIds]);
      await pool.query("DELETE FROM plans WHERE id = ANY($1::uuid[])", [plans]);
      for (const username of usernames) {
        await pool.query("DELETE FROM auth_login_attempts WHERE identity_hash = $1", [
          createHash("sha256").update(username.toLowerCase()).digest("hex"),
        ]);
      }
      await pool.end();
    }
  });

  it("denies missing auth, admin impersonation and another owner's branch scope", async () => {
    expect((await request(app.getHttpServer()).get(route("floors"))).status).toBe(401);
    expect((await request(app.getHttpServer()).get(route("floors")).set(admin())).status).toBe(403);
    expect((await request(app.getHttpServer()).get(route("floors")).set(auth(ownerOther))).status).toBe(404);
    const spoof = await request(app.getHttpServer()).post(route("floors")).set(owner())
      .send({ name: "Wrong tenant", restaurantId: restaurantB });
    expect(spoof.status).toBe(400);
  });

  it("creates floors and areas with tenant constraints; blocks archive while non-empty", async () => {
    const floor = await request(app.getHttpServer()).post(route("floors"))
      .set(owner()).send({ name: "الطابق الأرضي", sortOrder: 1 });
    expect(floor.status).toBe(201);
    floorId = floor.body.data.id;
    const area = await request(app.getHttpServer()).post(route("areas"))
      .set(owner()).send({ floorId, name: "الصالة الداخلية", sortOrder: 2 });
    expect(area.status).toBe(201);
    areaId = area.body.data.id;
    const cannotArchive = await request(app.getHttpServer()).delete(route("floors") + "/" + floorId).set(owner());
    expect(cannotArchive.status).toBe(409);
    expect(cannotArchive.body.error.code).toBe("FLOOR_NOT_EMPTY");
    const sameName = await request(app.getHttpServer()).post(route("floors"))
      .set(owner()).send({ name: "الطابق الأرضي" });
    expect(sameName.status).toBe(409);
    const otherFloor = await request(app.getHttpServer()).post("/api/v1/owner/branches/" + branchB + "/floors")
      .set(auth(ownerOther)).send({ name: "Other floor" });
    expect(otherFloor.status).toBe(201);
    const spoofArea = await request(app.getHttpServer()).post(route("areas")).set(owner())
      .send({ floorId: otherFloor.body.data.id, name: "Spoof" });
    expect(spoofArea.status).toBe(404);
  });

  it("creates a secure table QR; label edit keeps exact QR token and old identifier", async () => {
    const created = await request(app.getHttpServer()).post(route("tables")).set(owner())
      .send({ areaId, label: "طاولة 1", sortOrder: 1 });
    expect(created.status).toBe(201);
    tableId = created.body.data.id;
    const qr = await request(app.getHttpServer()).get("/api/v1/owner/tables/" + tableId + "/qr").set(owner());
    expect(qr.status).toBe(200);
    qrUrl = qr.body.data.url;
    firstToken = qrUrl.split("/").at(-1)!;
    expect(qrUrl).toMatch(/^https:\/\/customer\.example\.test\/t\/[\w-]{43}$/);
    const database = await pool.query("SELECT token_hash,token_box FROM qr_credentials WHERE table_id=$1", [tableId]);
    expect(database.rows[0].token_hash).toBe(hashQrToken(firstToken));
    expect(database.rows[0].token_box).not.toContain(firstToken);
    const renamed = await request(app.getHttpServer()).patch(route("tables") + "/" + tableId)
      .set(owner()).send({ label: "طاولة رقم 1", sortOrder: 5 });
    expect(renamed.status).toBe(200);
    const again = await request(app.getHttpServer()).get("/api/v1/owner/tables/" + tableId + "/qr").set(owner());
    expect(again.body.data.url).toBe(qrUrl);
    const publicRead = await request(app.getHttpServer()).get("/api/v1/public/t/" + firstToken);
    expect(publicRead.status).toBe(200);
    expect(publicRead.body.data).toMatchObject({
      table: { id: tableId, label: "طاولة رقم 1" }, callsAvailable: false,
    });
    expect(publicRead.body.data).not.toHaveProperty("sessionToken");
    expect(publicRead.body.data).not.toHaveProperty("qrToken");
  });

  it("blocks forged requests and duplicate labels, then disables and re-enables QR", async () => {
    const cross = await request(app.getHttpServer()).get("/api/v1/owner/tables/" + tableId + "/qr")
      .set(auth(ownerOther));
    expect(cross.status).toBe(404);
    expect((await request(app.getHttpServer()).post(route("tables")).set(owner())
      .send({ areaId, label: "طاولة رقم 1" })).status).toBe(409);
    const disabled = await request(app.getHttpServer())
      .post("/api/v1/owner/tables/" + tableId + "/qr/disable").set(owner());
    expect(disabled.status).toBe(200);
    const publicRead = await request(app.getHttpServer()).get("/api/v1/public/t/" + firstToken);
    expect(publicRead.status).toBe(404);
    const again = await request(app.getHttpServer()).patch(route("tables") + "/" + tableId)
      .set(owner()).send({ qrEnabled: true });
    expect(again.status).toBe(200);
    expect((await request(app.getHttpServer()).get("/api/v1/public/t/" + firstToken)).status).toBe(200);
    const bad = await request(app.getHttpServer()).post(route("tables") + "/bulk").set(owner())
      .send({ areaId, labels: ["Ta", "ta"] });
    expect(bad.status).toBe(400);
  });

  it("serializes concurrent bulk creation and applies restaurant-wide quota", async () => {
    const [a, b] = await Promise.all([
      request(app.getHttpServer()).post(route("tables") + "/bulk").set(owner())
        .send({ areaId, labels: ["T2", "T3"] }),
      request(app.getHttpServer()).post(route("tables") + "/bulk").set(owner())
        .send({ areaId, labels: ["T4", "T5"] }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 403]);
    const count = await pool.query("SELECT count(*)::int AS n FROM restaurant_tables WHERE restaurant_id=$1 AND archived_at IS NULL",
      [restaurantA]);
    expect(count.rows[0].n).toBe(3);
    const list = await request(app.getHttpServer()).get(route("tables") + "?limit=1").set(owner());
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.hasMore).toBe(true);
    const next = await request(app.getHttpServer()).get(route("tables") + "?limit=1&cursor=" +
      encodeURIComponent(list.body.meta.nextCursor)).set(owner());
    expect(next.status).toBe(200);
    expect(next.body.data[0].id).not.toBe(list.body.data[0].id);
    expect((await request(app.getHttpServer()).post(route("tables")).set(owner())
      .send({ areaId, label: "Quota bypass" })).status).toBe(403);
  });

  it("rotates QR atomically and rejects the old token; disabled remains disabled on rotation", async () => {
    const disabled = await request(app.getHttpServer()).patch(route("tables") + "/" + tableId)
      .set(owner()).send({ qrEnabled: false });
    expect(disabled.status).toBe(200);
    const rotated = await request(app.getHttpServer())
      .post("/api/v1/owner/tables/" + tableId + "/qr/rotate").set(owner());
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.version).toBe(2);
    expect(rotated.body.data.enabled).toBe(false);
    expect(rotated.body.data.url).not.toBe(qrUrl);
    expect((await request(app.getHttpServer()).get("/api/v1/public/t/" + firstToken)).status).toBe(404);
    const newToken = rotated.body.data.url.split("/").at(-1)!;
    expect((await request(app.getHttpServer()).get("/api/v1/public/t/" + newToken)).status).toBe(404);
    const enabled = await request(app.getHttpServer()).patch(route("tables") + "/" + tableId)
      .set(owner()).send({ qrEnabled: true });
    expect(enabled.status).toBe(200);
    expect((await request(app.getHttpServer()).get("/api/v1/public/t/" + newToken)).status).toBe(200);
    const credentials = await pool.query("SELECT version, revoked_at FROM qr_credentials WHERE table_id=$1 ORDER BY version",
      [tableId]);
    expect(credentials.rows).toHaveLength(2);
    expect(credentials.rows[0].revoked_at).not.toBeNull();
    expect(credentials.rows[1].revoked_at).toBeNull();
    qrUrl = rotated.body.data.url;
  });

  it("renders a valid PDF for owner; refuses other tenants and unexpected identifiers", async () => {
    const result = await request(app.getHttpServer()).get("/api/v1/owner/branches/" + branchA + "/qr/print")
      .set(owner()).buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
        response.on("error", callback);
      })
      .timeout({ response: 12000, deadline: 18000 });
    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toMatch(/application\/pdf/);
    expect(result.headers["cache-control"]).toBe("no-store");
    const pdfBytes = Buffer.isBuffer(result.body) ? result.body : Buffer.from(result.text, "binary");
    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBe(1);
    const selected = await request(app.getHttpServer())
      .get("/api/v1/owner/branches/" + branchA + "/qr/print?tableIds=" + tableId)
      .set(owner()).buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
        response.on("error", callback);
      })
      .timeout({ response: 12000, deadline: 18000 });
    expect(selected.status).toBe(200);
    expect((await PDFDocument.load(selected.body)).getPageCount()).toBe(1);
    const forbidden = await request(app.getHttpServer())
      .get("/api/v1/owner/branches/" + branchB + "/qr/print").set(owner());
    expect(forbidden.status).toBe(404);
    const invalid = await request(app.getHttpServer())
      .get("/api/v1/owner/branches/" + branchA + "/qr/print?tableIds=invalid").set(owner());
    expect(invalid.status).toBe(400);
  }, 25000);

  it("archives tables without losing QR history, frees quota and rejects old QR", async () => {
    const oldToken = qrUrl.split("/").at(-1)!;
    const archived = await request(app.getHttpServer()).delete(route("tables") + "/" + tableId).set(owner());
    expect(archived.status).toBe(200);
    expect((await request(app.getHttpServer()).get("/api/v1/public/t/" + oldToken)).status).toBe(404);
    expect((await request(app.getHttpServer()).get(route("tables") + "/" + tableId).set(owner())).status).toBe(404);
    const replacement = await request(app.getHttpServer()).post(route("tables")).set(owner())
      .send({ areaId, label: "Replacement" });
    expect(replacement.status).toBe(201);
    const retained = await pool.query("SELECT count(*)::int AS n FROM qr_credentials WHERE table_id=$1", [tableId]);
    expect(retained.rows[0].n).toBe(2);
    const areaBlocked = await request(app.getHttpServer()).delete(route("areas") + "/" + areaId).set(owner());
    expect(areaBlocked.status).toBe(409);
    expect(areaBlocked.body.error.code).toBe("AREA_NOT_EMPTY");
  });

  it("blocks table QR after invalid subscription and allows owner to view renewal status", async () => {
    const row = await pool.query("SELECT starts_at,ends_at,grace_ends_at FROM subscriptions WHERE id=$1", [subscriptions[0]]);
    const activeTable = await pool.query("SELECT qc.token_box,rt.id FROM qr_credentials qc INNER JOIN restaurant_tables rt ON rt.id=qc.table_id WHERE rt.restaurant_id=$1 AND qc.revoked_at IS NULL AND rt.archived_at IS NULL LIMIT 1", [restaurantA]);
    expect(activeTable.rows).toHaveLength(1);
    const id = activeTable.rows[0].id;
    const original = row.rows[0];
    await pool.query("UPDATE subscriptions SET starts_at=$2,ends_at=$3,grace_ends_at=$3 WHERE id=$1",
      [subscriptions[0], new Date(Date.now() - 70 * 86400_000), new Date(Date.now() - 35 * 86400_000)]);
    try {
      const ownerRead = await request(app.getHttpServer()).get(route("tables")).set(owner());
      expect(ownerRead.status).toBe(403);
      expect(ownerRead.body.error.code).toBe("SUBSCRIPTION_INACTIVE");
      expect((await request(app.getHttpServer())
        .get("/api/v1/owner/subscription").set(owner())).status).toBe(200);
      const token = (await request(app.getHttpServer())
        .get("/api/v1/owner/tables/" + id + "/qr").set(owner())).status;
      expect(token).toBe(403);
    } finally {
      await pool.query("UPDATE subscriptions SET starts_at=$2,ends_at=$3,grace_ends_at=$4 WHERE id=$1",
        [subscriptions[0], original.starts_at, original.ends_at, original.grace_ends_at]);
    }
  });

  it("exposes implemented routes in generated Swagger", async () => {
    const schema = await request(app.getHttpServer()).get("/api/docs-json");
    expect(schema.status).toBe(200);
    const paths = schema.body.paths;
    expect(paths["/api/v1/owner/branches/{branchId}/floors"].post).toBeDefined();
    expect(paths["/api/v1/owner/branches/{branchId}/areas"].post).toBeDefined();
    expect(paths["/api/v1/owner/branches/{branchId}/tables/bulk"].post).toBeDefined();
    expect(paths["/api/v1/owner/tables/{tableId}/qr/rotate"].post).toBeDefined();
    expect(paths["/api/v1/owner/branches/{branchId}/qr/print"].get).toBeDefined();
    expect(paths["/api/v1/public/t/{qrToken}"].get).toBeDefined();
  });
});
