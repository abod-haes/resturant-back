import { createHash, randomUUID } from "node:crypto";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { configureHttpApp } from "../../src/bootstrap";
import { hashPassword } from "../../src/common/crypto/password";

const ADMIN_PASSWORD = "AdminOnboardingPassword_2026!";
const OWNER_PASSWORD = "OwnerOnboardingPassword_2026!";
const OWNER_CHANGED_PASSWORD = "OwnerChangedPassword_2026!";

describe("Platform restaurant onboarding (real PostgreSQL)", () => {
  let pool: Pool;
  let app: INestApplication;
  let primaryToken: string;
  let platformToken: string;
  let createdRestaurantId: string;
  let createdOwnerId: string;
  let createdBranchId: string;
  let createdOwnerUsername: string;
  const userIds: string[] = [];
  const restaurantIds: string[] = [];
  const branchIds: string[] = [];
  const usernames: string[] = [];
  const loginName = () => "onboarding_" + randomUUID().replaceAll("-", "");

  const payload = (username: string, name = "مطعم الريحان") => ({
    name,
    owner: { name: "صاحب المطعم", username, initialPassword: OWNER_PASSWORD },
    initialBranch: { name: "الفرع الرئيسي" },
  });

  async function createLoginUser(role: "PRIMARY_ADMIN" | "PLATFORM_ADMIN"): Promise<string> {
    const username = loginName();
    const id = randomUUID();
    userIds.push(id);
    usernames.push(username);
    await pool.query(
      `INSERT INTO users (id,username,display_name,password_hash,role,must_change_password)
       VALUES ($1,$2,'Admin Test',$3,$4,false)`,
      [id, username, await hashPassword(ADMIN_PASSWORD), role],
    );
    const response = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username, password: ADMIN_PASSWORD, client: "mobile" });
    expect(response.status).toBe(200);
    return response.body.data.accessToken as string;
  }

  async function postRestaurant(body: object, token = primaryToken) {
    return request(app.getHttpServer()).post("/api/v1/admin/restaurants")
      .set("Authorization", "Bearer " + token)
      .set("x-request-id", "test-restaurant-onboarding")
      .send(body);
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureHttpApp(app);
    await app.init();
    primaryToken = await createLoginUser("PRIMARY_ADMIN");
    platformToken = await createLoginUser("PLATFORM_ADMIN");
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pool) {
      await pool.query("DELETE FROM audit_logs WHERE restaurant_id = ANY($1::uuid[]) OR actor_user_id = ANY($2::uuid[])", [restaurantIds, userIds]);
      await pool.query("DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])", [userIds]);
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
      await pool.query("DELETE FROM branches WHERE id = ANY($1::uuid[])", [branchIds]);
      await pool.query("DELETE FROM restaurants WHERE id = ANY($1::uuid[])", [restaurantIds]);
      for (const username of usernames) {
        await pool.query("DELETE FROM auth_login_attempts WHERE identity_hash = $1",
          [createHash("sha256").update(username.toLowerCase()).digest("hex")]);
      }
      await pool.end();
    }
  });

  it("rejects missing authorization and malformed nested inputs", async () => {
    const unauthorized = await request(app.getHttpServer()).post("/api/v1/admin/restaurants")
      .send(payload(loginName()));
    expect(unauthorized.status).toBe(401);

    const invalid = await postRestaurant({
      ...payload(loginName()),
      owner: { username: "bad name", initialPassword: "short", name: " " },
      initialBranch: { name: "Valid", forbidden: "extra" },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("creates restaurant, owner and branch in one transaction and audits the operation", async () => {
    createdOwnerUsername = loginName();
    const response = await postRestaurant(payload(createdOwnerUsername));
    expect(response.status).toBe(201);
    expect(response.body.data.name).toBe("مطعم الريحان");
    const { id, ownerId, branchId } = response.body.data;
    expect(id).toEqual(expect.any(String));
    createdRestaurantId = id;
    createdOwnerId = ownerId;
    createdBranchId = branchId;
    restaurantIds.push(id);
    userIds.push(ownerId);
    branchIds.push(branchId);
    usernames.push(createdOwnerUsername);

    const records = await Promise.all([
      pool.query("SELECT name,slug FROM restaurants WHERE id = $1", [id]),
      pool.query("SELECT restaurant_id,name FROM branches WHERE id = $1", [branchId]),
      pool.query("SELECT restaurant_id,username,role,must_change_password,password_hash FROM users WHERE id = $1", [ownerId]),
      pool.query("SELECT actor_user_id,request_id,metadata FROM audit_logs WHERE entity_id = $1 AND action = 'restaurant.created'", [id]),
    ]);
    expect(records[0].rows[0].name).toBe("مطعم الريحان");
    expect(records[0].rows[0].slug).toMatch(/^r-[a-f0-9]{32}$/);
    expect(records[1].rows[0]).toMatchObject({ restaurant_id: id, name: "الفرع الرئيسي" });
    expect(records[2].rows[0]).toMatchObject({
      restaurant_id: id, username: createdOwnerUsername,
      role: "RESTAURANT_OWNER", must_change_password: true,
    });
    expect(records[2].rows[0].password_hash).toMatch(/^scrypt\$/);
    expect(records[2].rows[0].password_hash).not.toBe(OWNER_PASSWORD);
    expect(records[3].rows[0].request_id).toBe("test-restaurant-onboarding");
    expect(records[3].rows[0].metadata).toMatchObject({ ownerId, branchId });
  });

  it("rolls back all inserts if owner username is already used", async () => {
    const before = await pool.query<{ total: string }>("SELECT count(*)::text AS total FROM restaurants");
    const response = await postRestaurant(payload(createdOwnerUsername));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("OWNER_USERNAME_TAKEN");
    const after = await pool.query<{ total: string }>("SELECT count(*)::text AS total FROM restaurants");
    expect(after.rows[0].total).toBe(before.rows[0].total);
  });

  it("lets platform admin onboard, but blocks owners and requires their initial password change", async () => {
    const username = loginName();
    const onboard = await postRestaurant(payload(username,"Platform Created"), platformToken);
    expect(onboard.status).toBe(201);
    const { id, ownerId, branchId } = onboard.body.data;
    restaurantIds.push(id);
    userIds.push(ownerId);
    branchIds.push(branchId);
    usernames.push(username);

    const ownerLogin = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username: createdOwnerUsername, password: OWNER_PASSWORD, client: "mobile" });
    expect(ownerLogin.status).toBe(200);
    expect(ownerLogin.body.data.user.mustChangePassword).toBe(true);
    const bearer = "Bearer " + ownerLogin.body.data.accessToken;
    const forbiddenUntilChanged = await request(app.getHttpServer()).get("/api/v1/admin/restaurants")
      .set("Authorization", bearer);
    expect(forbiddenUntilChanged.status).toBe(403);
    expect(forbiddenUntilChanged.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    const changed = await request(app.getHttpServer()).post("/api/v1/auth/change-password")
      .set("Authorization",bearer)
      .send({ currentPassword: OWNER_PASSWORD, newPassword: OWNER_CHANGED_PASSWORD });
    expect(changed.status).toBe(200);
    const relogin = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username: createdOwnerUsername, password: OWNER_CHANGED_PASSWORD, client: "mobile" });
    expect(relogin.status).toBe(200);
    const forbiddenByRole = await request(app.getHttpServer()).get("/api/v1/admin/restaurants")
      .set("Authorization", "Bearer " + relogin.body.data.accessToken);
    expect(forbiddenByRole.status).toBe(403);
  });

  it("reads details and updates name/state with audit, including immediate owner deactivation", async () => {
    const detail = await request(app.getHttpServer()).get("/api/v1/admin/restaurants/" + createdRestaurantId)
      .set("Authorization", "Bearer " + primaryToken);
    expect(detail.status).toBe(200);
    expect(detail.body.data.owner).toMatchObject({
      id: createdOwnerId, username: createdOwnerUsername,
    });
    expect(detail.body.data.initialBranch.id).toBe(createdBranchId);
    expect(detail.body.data.isActive).toBe(true);

    const activeLogin = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username: createdOwnerUsername, password: OWNER_CHANGED_PASSWORD, client: "mobile" });
    expect(activeLogin.status).toBe(200);
    const disabled = await request(app.getHttpServer()).patch("/api/v1/admin/restaurants/" + createdRestaurantId)
      .set("Authorization", "Bearer " + primaryToken)
      .send({ name: "مطعم الريحان الجديد", isActive: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data.name).toBe("مطعم الريحان الجديد");
    expect(disabled.body.data.isActive).toBe(false);
    const inactiveOwner = await request(app.getHttpServer()).get("/api/v1/auth/me")
      .set("Authorization", "Bearer " + activeLogin.body.data.accessToken);
    expect(inactiveOwner.status).toBe(401);

    const reactivate = await request(app.getHttpServer()).patch("/api/v1/admin/restaurants/" + createdRestaurantId)
      .set("Authorization", "Bearer " + primaryToken).send({ isActive: true });
    expect(reactivate.status).toBe(200);
    const audit = await pool.query("SELECT action FROM audit_logs WHERE entity_id = $1", [createdRestaurantId]);
    expect(audit.rows.filter((row) => row.action === "restaurant.updated")).toHaveLength(2);
  });

  it("validates PATCH input and unknown restaurant IDs", async () => {
    const authorization = "Bearer " + primaryToken;
    expect((await request(app.getHttpServer()).patch("/api/v1/admin/restaurants/" + createdRestaurantId)
      .set("Authorization", authorization).send({})).status).toBe(400);
    expect((await request(app.getHttpServer()).patch("/api/v1/admin/restaurants/" + createdRestaurantId)
      .set("Authorization", authorization).send({ isActive: "false" })).status).toBe(400);
    expect((await request(app.getHttpServer()).get("/api/v1/admin/restaurants/not-an-id")
      .set("Authorization", authorization)).status).toBe(400);
    expect((await request(app.getHttpServer()).get("/api/v1/admin/restaurants/" + randomUUID())
      .set("Authorization", authorization)).status).toBe(404);
  });

  it("accepts legacy PostgreSQL UUID identifiers in detail and patch routes", async () => {
    const legacyId = "803852bc-d9d5-96c4-f879-9648831f85cf";
    // A fresh legacy identifier with non-v4 bits; do not collide with fixtures in tests.
    const id = "f07b6c85-3f0a-dfc1-95fe-a1cb8c6c85a8";
    expect(id).not.toBe(legacyId);
    const slug = "legacy-" + id.replaceAll("-", "");
    restaurantIds.push(id);
    await pool.query("INSERT INTO restaurants (id,name,slug) VALUES ($1,$2,$3)",
      [id, "Legacy restaurant", slug]);
    const bearer = "Bearer " + primaryToken;
    const detail = await request(app.getHttpServer()).get("/api/v1/admin/restaurants/" + id)
      .set("Authorization", bearer);
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe(id);
    const update = await request(app.getHttpServer()).patch("/api/v1/admin/restaurants/" + id)
      .set("Authorization", bearer).send({ name: "Updated legacy restaurant" });
    expect(update.status).toBe(200);
    expect(update.body.data.name).toBe("Updated legacy restaurant");
    const malformed = await request(app.getHttpServer()).get("/api/v1/admin/restaurants/invalid-id")
      .set("Authorization", bearer);
    expect(malformed.status).toBe(400);
  });

  it("uses stable paginated, case-insensitive name filtering and enforces limit caps", async () => {
    for (const name of ["Basil Alpha", "Basil Beta", "Basil Gamma"]) {
      const username = loginName();
      const response = await postRestaurant(payload(username,name));
      expect(response.status).toBe(201);
      const { id, ownerId, branchId } = response.body.data;
      restaurantIds.push(id); userIds.push(ownerId); branchIds.push(branchId); usernames.push(username);
    }
    const authorization = "Bearer " + platformToken;
    const first = await request(app.getHttpServer()).get("/api/v1/admin/restaurants?limit=2")
      .set("Authorization", authorization);
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.meta).toMatchObject({ hasMore: true });
    expect(first.body.meta.nextCursor).toEqual(expect.any(String));
    const second = await request(app.getHttpServer())
      .get("/api/v1/admin/restaurants?limit=2&cursor=" + encodeURIComponent(first.body.meta.nextCursor))
      .set("Authorization", authorization);
    expect(second.status).toBe(200);
    expect(second.body.data).toHaveLength(2);
    const firstIds = new Set(first.body.data.map((row: {id: string})=>row.id));
    expect(second.body.data.every((row: {id: string})=>!firstIds.has(row.id))).toBe(true);
    const last = await request(app.getHttpServer())
      .get("/api/v1/admin/restaurants?limit=2&cursor=" + encodeURIComponent(second.body.meta.nextCursor))
      .set("Authorization", authorization);
    expect(last.status).toBe(200);
    expect(last.body.meta.hasMore).toBe(false);

    const search = await request(app.getHttpServer())
      .get("/api/v1/admin/restaurants?search=BASIL")
      .set("Authorization", authorization);
    expect(search.status).toBe(200);
    expect(search.body.data).toHaveLength(3);
    const literal = await request(app.getHttpServer())
      .get("/api/v1/admin/restaurants?search=%25")
      .set("Authorization", authorization);
    expect(literal.status).toBe(200);
    expect(literal.body.data).toHaveLength(0);
    const tooLarge = await request(app.getHttpServer())
      .get("/api/v1/admin/restaurants?limit=101").set("Authorization", authorization);
    expect(tooLarge.status).toBe(400);
    const invalidCursor = await request(app.getHttpServer())
      .get("/api/v1/admin/restaurants?cursor=invalid").set("Authorization", authorization);
    expect(invalidCursor.status).toBe(400);
  });

  it("publishes the actual versioned Swagger contract", async () => {
    const schema = await request(app.getHttpServer()).get("/api/docs-json");
    expect(schema.status).toBe(200);
    const paths = schema.body.paths;
    expect(paths["/api/v1/admin/restaurants"].post.responses["201"]).toBeDefined();
    expect(paths["/api/v1/admin/restaurants"].get.responses["200"]).toBeDefined();
    expect(paths["/api/v1/admin/restaurants/{id}"].patch).toBeDefined();
    expect(paths["/api/v1/admin/restaurants/{id}"].get).toBeDefined();
  });
});
