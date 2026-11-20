import { randomUUID } from "node:crypto";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { configureHttpApp } from "../../src/bootstrap";
import { hashPassword } from "../../src/common/crypto/password";

const PASSWORD = "StrongAdminPass2026!_Secure";
const NEXT_PASSWORD = "AnotherAdminPass2026!_Secure";

describe("Primary-only platform administrator management (PostgreSQL)", () => {
  let app: INestApplication;
  let pool: Pool;
  let primary: string;
  let secondary: string;
  let primaryId: string;
  let secondaryId: string;
  let managedId: string;
  let managedUsername: string;
  const ids: string[] = [];

  const username = () => "pa_" + randomUUID().replaceAll("-", "");
  const bearer = (token: string) => "Bearer " + token;
  const auth = (token: string) => ({ Authorization: bearer(token) });

  async function seed(role: "PRIMARY_ADMIN" | "PLATFORM_ADMIN") {
    const id = randomUUID();
    const login = username();
    ids.push(id);
    await pool.query(
      "INSERT INTO users (id,username,display_name,password_hash,role,must_change_password) VALUES ($1,$2,$3,$4,$5,false)",
      [id, login, role, await hashPassword(PASSWORD), role],
    );
    const signed = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username: login, password: PASSWORD, client: "mobile" });
    expect(signed.status).toBe(200);
    return { id, token: signed.body.data.accessToken as string };
  }

  async function createAdmin(name = "New Global Admin", login = username()) {
    const response = await request(app.getHttpServer()).post("/api/v1/admin/platform-admins")
      .set(auth(primary)).set("x-request-id", "pa-create-2026")
      .send({ username: login, name, initialPassword: PASSWORD });
    if (response.status === 201) ids.push(response.body.data.id as string);
    return response;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureHttpApp(app);
    await app.init();
    const owner = await seed("PRIMARY_ADMIN");
    primary = owner.token;
    primaryId = owner.id;
    const other = await seed("PLATFORM_ADMIN");
    secondary = other.token;
    secondaryId = other.id;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pool) {
      await pool.query("DELETE FROM audit_logs WHERE actor_user_id = ANY($1::uuid[]) OR entity_id = ANY($1::uuid[])", [ids]);
      await pool.query("DELETE FROM auth_refresh_history WHERE session_id IN (SELECT id FROM auth_sessions WHERE user_id = ANY($1::uuid[]))", [ids]);
      await pool.query("DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])", [ids]);
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [ids]);
      await pool.end();
    }
  });

  it("rejects non-primary actors and invalid or privilege-escalating input", async () => {
    const body = { name: "Nope", username: username(), initialPassword: PASSWORD };
    const path = "/api/v1/admin/platform-admins";
    expect((await request(app.getHttpServer()).post(path).send(body)).status).toBe(401);
    expect((await request(app.getHttpServer()).post(path).set(auth(secondary)).send(body)).status).toBe(403);
    expect((await request(app.getHttpServer()).get(path).set(auth(secondary))).status).toBe(403);
    expect((await request(app.getHttpServer()).post(path).set(auth(primary))
      .send({ ...body, role: "PRIMARY_ADMIN" })).status).toBe(400);
    expect((await request(app.getHttpServer()).post(path).set(auth(primary))
      .send({ ...body, restaurantId: randomUUID() })).status).toBe(400);
    expect((await request(app.getHttpServer()).post(path).set(auth(primary))
      .send({ ...body, initialPassword: "short" })).status).toBe(400);
  });

  it("creates scoped global admin, requires first password change and redacts secrets", async () => {
    managedUsername = username();
    const created = await createAdmin("مدير المنصة", managedUsername);
    expect(created.status).toBe(201);
    managedId = created.body.data.id as string;
    expect(created.body.data).toMatchObject({
      username: managedUsername, name: "مدير المنصة",
      role: "PLATFORM_ADMIN", isActive: true, mustChangePassword: true,
    });
    expect(created.body.data.passwordHash).toBeUndefined();
    expect(created.body.data.initialPassword).toBeUndefined();
    const stored = await pool.query("SELECT role,restaurant_id,branch_id,department,password_hash FROM users WHERE id=$1", [managedId]);
    expect(stored.rows[0]).toMatchObject({ role: "PLATFORM_ADMIN", restaurant_id: null, branch_id: null, department: null });
    expect(stored.rows[0].password_hash).toMatch(/^scrypt\$/);
    const signed = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username: managedUsername, password: PASSWORD, client: "mobile" });
    expect(signed.status).toBe(200);
    expect(signed.body.data.user.mustChangePassword).toBe(true);
    expect((await request(app.getHttpServer()).get("/api/v1/admin/restaurants")
      .set(auth(signed.body.data.accessToken))).status).toBe(403);
    const audit = await pool.query("SELECT action, request_id, metadata FROM audit_logs WHERE entity_id=$1", [managedId]);
    expect(audit.rows).toEqual(expect.arrayContaining([expect.objectContaining({
      action: "platform_admin.created", request_id: "pa-create-2026", metadata: {},
    })]));
  });

  it("rejects username collision case-insensitively and cannot touch PRIMARY_ADMIN", async () => {
    const duplicate = await createAdmin("Duplicate", managedUsername.toUpperCase());
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("PLATFORM_ADMIN_USERNAME_TAKEN");
    const restricted = "/api/v1/admin/platform-admins/" + primaryId;
    expect((await request(app.getHttpServer()).get(restricted).set(auth(primary))).status).toBe(404);
    expect((await request(app.getHttpServer()).patch(restricted)
      .set(auth(primary)).send({ isActive: false })).status).toBe(404);
    expect((await request(app.getHttpServer()).post(restricted + "/reset-password")
      .set(auth(primary)).send({ initialPassword: NEXT_PASSWORD })).status).toBe(404);
    expect((await request(app.getHttpServer()).get("/api/v1/admin/platform-admins/" + randomUUID())
      .set(auth(primary))).status).toBe(404);
    expect((await request(app.getHttpServer()).patch("/api/v1/admin/platform-admins/" + secondaryId)
      .set(auth(secondary)).send({ isActive: false })).status).toBe(403);
  });

  it("paginates with filters, validates cursors and disallows empty PATCH", async () => {
    const prefix = "uniquePA_" + randomUUID().slice(0, 8);
    for (const suffix of ["a", "b", "c"]) {
      expect((await createAdmin(prefix + suffix)).status).toBe(201);
    }
    const path = "/api/v1/admin/platform-admins";
    const first = await request(app.getHttpServer()).get(path + "?limit=2&search=" + prefix)
      .set(auth(primary));
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.meta.hasMore).toBe(true);
    const second = await request(app.getHttpServer()).get(path + "?limit=2&search=" + prefix +
      "&cursor=" + encodeURIComponent(first.body.meta.nextCursor)).set(auth(primary));
    expect(second.status).toBe(200);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.meta.hasMore).toBe(false);
    expect(new Set([...first.body.data, ...second.body.data].map((row: { id: string }) => row.id)).size).toBe(3);
    expect((await request(app.getHttpServer()).get(path + "?limit=101").set(auth(primary))).status).toBe(400);
    expect((await request(app.getHttpServer()).get(path + "?cursor=bad").set(auth(primary))).status).toBe(400);
    expect((await request(app.getHttpServer()).patch(path + "/" + managedId)
      .set(auth(primary)).send({})).status).toBe(400);
  });

  it("revokes access on disable and reset, never exposes the reset password", async () => {
    const path = "/api/v1/admin/platform-admins/" + managedId;
    const old = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username: managedUsername, password: PASSWORD, client: "mobile" });
    expect(old.status).toBe(200);
    const disabled = await request(app.getHttpServer()).patch(path).set(auth(primary))
      .send({ name: "Updated", isActive: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data).toMatchObject({ name: "Updated", isActive: false });
    expect((await request(app.getHttpServer()).get("/api/v1/auth/me")
      .set(auth(old.body.data.accessToken))).status).toBe(401);
    expect((await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username: managedUsername, password: PASSWORD, client: "mobile" })).status).toBe(401);
    expect((await request(app.getHttpServer()).patch(path).set(auth(primary))
      .send({ isActive: true })).status).toBe(200);
    const active = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username: managedUsername, password: PASSWORD, client: "mobile" });
    expect(active.status).toBe(200);
    const reset = await request(app.getHttpServer()).post(path + "/reset-password")
      .set(auth(primary)).set("x-request-id", "pa-reset-2026")
      .send({ initialPassword: NEXT_PASSWORD });
    expect(reset.status).toBe(201 === reset.status ? 201 : 200);
    expect(reset.body).toEqual({ data: { reset: true } });
    expect((await request(app.getHttpServer()).get("/api/v1/auth/me")
      .set(auth(active.body.data.accessToken))).status).toBe(401);
    expect((await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username: managedUsername, password: PASSWORD, client: "mobile" })).status).toBe(401);
    const next = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username: managedUsername, password: NEXT_PASSWORD, client: "mobile" });
    expect(next.status).toBe(200);
    expect(next.body.data.user.mustChangePassword).toBe(true);
    const audit = await pool.query("SELECT action,request_id,metadata FROM audit_logs WHERE entity_id=$1", [managedId]);
    expect(audit.rows).toEqual(expect.arrayContaining([expect.objectContaining({
      action: "platform_admin.password_reset", request_id: "pa-reset-2026", metadata: {},
    })]));
    expect(JSON.stringify(audit.rows)).not.toContain(NEXT_PASSWORD);
  });

  it("publishes primary-only routes to generated Swagger", async () => {
    const schema = await request(app.getHttpServer()).get("/api/docs-json");
    expect(schema.status).toBe(200);
    expect(schema.body.paths["/api/v1/admin/platform-admins"].post).toBeDefined();
    expect(schema.body.paths["/api/v1/admin/platform-admins"].get).toBeDefined();
    expect(schema.body.paths["/api/v1/admin/platform-admins/{id}"].patch).toBeDefined();
    expect(schema.body.paths["/api/v1/admin/platform-admins/{id}/reset-password"].post).toBeDefined();
  });
});
