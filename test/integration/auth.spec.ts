import { randomUUID, createHash } from "node:crypto";
import { Controller, Get, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { configureHttpApp } from "../../src/bootstrap";
import { BranchScope, Roles } from "../../src/common/auth/policy.decorators";
import { hashPassword } from "../../src/modules/auth/domain/password";

@Controller("__auth_policy_probe")
class PolicyProbeController {
  @Get("owner/:branchId")
  @Roles("RESTAURANT_OWNER")
  @BranchScope("branchId")
  ownerBranch(): { data: { allowed: boolean } } { return { data: { allowed: true } }; }

  @Get("employee/:branchId")
  @Roles("EMPLOYEE")
  @BranchScope("branchId")
  employeeBranch(): { data: { allowed: boolean } } { return { data: { allowed: true } }; }

  @Get("admin")
  @Roles("PRIMARY_ADMIN")
  admin(): { data: { allowed: boolean } } { return { data: { allowed: true } }; }

  @Get("unconfigured")
  unconfigured(): { data: { allowed: boolean } } { return { data: { allowed: true } }; }
}

const PASSWORD = "InitialPassword_2026!";
const NEW_PASSWORD = "ChangedPassword_2026!";

describe("Authentication and RBAC against PostgreSQL", () => {
  let app: INestApplication;
  let pool: Pool;
  let restaurantA: string;
  let restaurantB: string;
  let branchA: string;
  let branchB: string;
  let owner: string;
  let staff: string;
  let primary: string;
  let passwordUser: string;
  const ids: string[] = [];
  const loginNames: string[] = [];
  const randomName = () => "auth_" + randomUUID().replaceAll("-", "");

  async function createRestaurant(): Promise<string> {
    const id = randomUUID();
    await pool.query("INSERT INTO restaurants (id,name,slug) VALUES ($1,$2,$3)",
      [id,"Auth test restaurant","rest-" + id]);
    return id;
  }

  async function createBranch(restaurantId: string): Promise<string> {
    const id = randomUUID();
    await pool.query("INSERT INTO branches (id,restaurant_id,name,slug) VALUES ($1,$2,$3,$4)",
      [id,restaurantId,"Auth test branch","branch-" + id]);
    return id;
  }

  async function createUser(role: string, restaurantId: string | null, branchId: string | null,
    department: string | null, mustChange = false): Promise<string> {
    const username = randomName();
    loginNames.push(username);
    const id = randomUUID();
    await pool.query(`INSERT INTO users (id,username,display_name,password_hash,role,restaurant_id,branch_id,department,must_change_password)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id,username,"Auth Test",await hashPassword(PASSWORD),role,restaurantId,branchId,department,mustChange]);
    ids.push(id);
    return username;
  }

  async function login(username: string, client: "mobile" | "web" = "mobile") {
    return request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username, password: PASSWORD, client });
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    restaurantA = await createRestaurant();
    restaurantB = await createRestaurant();
    branchA = await createBranch(restaurantA);
    branchB = await createBranch(restaurantB);
    owner = await createUser("RESTAURANT_OWNER",restaurantA,null,null);
    staff = await createUser("EMPLOYEE",restaurantB,branchB,"waiter");
    primary = await createUser("PRIMARY_ADMIN",null,null,null);
    passwordUser = await createUser("PLATFORM_ADMIN",null,null,null,true);

    const module = await Test.createTestingModule({
      imports: [AppModule], controllers: [PolicyProbeController],
    }).compile();
    app = module.createNestApplication();
    configureHttpApp(app);
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pool) {
      await pool.query("DELETE FROM audit_logs WHERE actor_user_id = ANY($1::uuid[])",[ids]);
      await pool.query("DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])",[ids]);
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])",[ids]);
      await pool.query("DELETE FROM branches WHERE id = ANY($1::uuid[])",[[branchA,branchB]]);
      await pool.query("DELETE FROM restaurants WHERE id = ANY($1::uuid[])",[[restaurantA,restaurantB]]);
      for (const name of loginNames) {
        const key = createHash("sha256").update(name.toLowerCase()).digest("hex");
        await pool.query("DELETE FROM auth_login_attempts WHERE identity_hash = $1",[key]);
      }
      await pool.end();
    }
  });

  it("rejects unknown credentials with uniform response", async () => {
    const bad = await login(randomName());
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("UNAUTHORIZED");
    const wrong = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username: owner, password: "WrongPassword_2026!", client: "mobile" });
    expect(wrong.status).toBe(401);
  });

  it("requires authorization header and returns scoped principal", async () => {
    const unauthenticated = await request(app.getHttpServer()).get("/api/v1/auth/me");
    expect(unauthenticated.status).toBe(401);
    const signed = await login(owner);
    expect(signed.status).toBe(200);
    expect(signed.body.data.refreshToken).toEqual(expect.any(String));
    const response = await request(app.getHttpServer()).get("/api/v1/auth/me")
      .set("Authorization", "Bearer " + signed.body.data.accessToken);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      role: "RESTAURANT_OWNER", restaurantId: restaurantA, branchId: null,
    });
    expect(response.body.data.sessionId).toBeUndefined();
  });

  it("rejects cross-tenant owner or employee resource access and undefined roles", async () => {
    const signedOwner = await login(owner);
    const ownerBearer = "Bearer " + signedOwner.body.data.accessToken;
    expect((await request(app.getHttpServer()).get("/api/v1/__auth_policy_probe/owner/" + branchA).set("Authorization",ownerBearer)).status).toBe(200);
    expect((await request(app.getHttpServer()).get("/api/v1/__auth_policy_probe/owner/" + branchB).set("Authorization",ownerBearer)).status).toBe(404);
    expect((await request(app.getHttpServer()).get("/api/v1/__auth_policy_probe/owner/not-a-uuid").set("Authorization",ownerBearer)).status).toBe(404);
    expect((await request(app.getHttpServer()).get("/api/v1/__auth_policy_probe/admin").set("Authorization",ownerBearer)).status).toBe(403);
    expect((await request(app.getHttpServer()).get("/api/v1/__auth_policy_probe/unconfigured").set("Authorization",ownerBearer)).status).toBe(403);

    const signedStaff = await login(staff);
    const staffBearer = "Bearer " + signedStaff.body.data.accessToken;
    expect((await request(app.getHttpServer()).get("/api/v1/__auth_policy_probe/employee/" + branchB).set("Authorization",staffBearer)).status).toBe(200);
    expect((await request(app.getHttpServer()).get("/api/v1/__auth_policy_probe/employee/" + branchA).set("Authorization",staffBearer)).status).toBe(404);
    expect((await request(app.getHttpServer()).get("/api/v1/__auth_policy_probe/owner/" + branchB).set("Authorization",staffBearer)).status).toBe(403);

    const signedPrimary = await login(primary);
    expect((await request(app.getHttpServer()).get("/api/v1/__auth_policy_probe/admin")
      .set("Authorization","Bearer " + signedPrimary.body.data.accessToken)).status).toBe(200);
    expect((await request(app.getHttpServer()).get("/api/v1/__auth_policy_probe/owner/" + branchA)
      .set("Authorization","Bearer " + signedPrimary.body.data.accessToken)).status).toBe(403);
  });

  it("rotates mobile refresh tokens and revokes sessions on replay", async () => {
    const signed = await login(primary);
    const oldToken = signed.body.data.refreshToken;
    const rotated = await request(app.getHttpServer()).post("/api/v1/auth/refresh").send({ refreshToken: oldToken });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.refreshToken).not.toBe(oldToken);
    const replay = await request(app.getHttpServer()).post("/api/v1/auth/refresh").send({ refreshToken: oldToken });
    expect(replay.status).toBe(401);
    expect((await request(app.getHttpServer()).get("/api/v1/auth/me")
      .set("Authorization","Bearer " + rotated.body.data.accessToken)).status).toBe(401);
  });

  it("uses an HttpOnly browser cookie and enforces Origin on cookie operations", async () => {
    const signed = await login(primary,"web");
    expect(signed.status).toBe(200);
    expect(signed.body.data.refreshToken).toBeUndefined();
    const cookies = signed.headers["set-cookie"];
    expect(Array.isArray(cookies)).toBe(true);
    if (!Array.isArray(cookies)) throw new Error("Cookie missing");
    const cookie = String(cookies[0]).split(";")[0];
    expect(String(cookies[0])).toContain("HttpOnly");

    const denied = await request(app.getHttpServer()).post("/api/v1/auth/refresh")
      .set("Cookie",cookie).send({});
    expect(denied.status).toBe(401);
    const allowed = await request(app.getHttpServer()).post("/api/v1/auth/refresh")
      .set("Cookie",cookie).set("Origin","http://localhost:5173").send({});
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.refreshToken).toBeUndefined();
  });

  it("allows normal access before an optional password change and invalidates sessions after it", async () => {
    const signed = await login(passwordUser);
    expect(signed.status).toBe(200);
    expect(signed.body.data.user.mustChangePassword).toBe(true);
    const authorization = "Bearer " + signed.body.data.accessToken;
    expect((await request(app.getHttpServer()).get("/api/v1/__auth_policy_probe/admin")
      .set("Authorization",authorization)).status).toBe(200);
    expect((await request(app.getHttpServer()).get("/api/v1/auth/me")
      .set("Authorization",authorization)).status).toBe(200);
    const changed = await request(app.getHttpServer()).post("/api/v1/auth/change-password")
      .set("Authorization",authorization).set("x-request-id","auth-change-password-2026")
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(changed.status).toBe(200);
    expect((await request(app.getHttpServer()).get("/api/v1/auth/me")
      .set("Authorization",authorization)).status).toBe(401);
    const next = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ username: passwordUser, password: NEW_PASSWORD, client: "mobile" });
    expect(next.status).toBe(200);
    expect(next.body.data.user.mustChangePassword).toBe(false);
    const audit = await pool.query("SELECT action, request_id FROM audit_logs WHERE actor_user_id = $1",[
      next.body.data.user.id,
    ]);
    expect(audit.rows).toEqual(expect.arrayContaining([expect.objectContaining({
      action: "auth.password_changed", request_id: "auth-change-password-2026",
    })]));
  });

  it("returns 401 for sessions belonging to deactivated users", async () => {
    const signed = await login(staff);
    const userId = signed.body.data.user.id;
    await pool.query("UPDATE users SET is_active = false WHERE id = $1",[userId]);
    try {
      const response = await request(app.getHttpServer()).get("/api/v1/auth/me")
        .set("Authorization","Bearer " + signed.body.data.accessToken);
      expect(response.status).toBe(401);
    } finally {
      await pool.query("UPDATE users SET is_active = true WHERE id = $1",[userId]);
    }
  });

  it("rate limits repeated invalid passwords by normalized username", async () => {
    const username = randomName();
    const key = createHash("sha256").update(username.toLowerCase()).digest("hex");
    try {
      for (let i = 0; i < 5; i++) {
        const response = await request(app.getHttpServer()).post("/api/v1/auth/login")
          .send({ username, password: "DifferentPassword_2026!", client: "mobile" });
        expect(response.status).toBe(401);
      }
      const blocked = await request(app.getHttpServer()).post("/api/v1/auth/login")
        .send({ username: username.toUpperCase(), password: "DifferentPassword_2026!", client: "mobile" });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("RATE_LIMITED");
    } finally {
      await pool.query("DELETE FROM auth_login_attempts WHERE identity_hash = $1",[key]);
    }
  });

  it("generates OpenAPI for implemented authentication endpoints", async () => {
    const response = await request(app.getHttpServer()).get("/api/docs-json");
    expect(response.status).toBe(200);
    expect(response.body.paths["/api/v1/auth/login"].post).toBeDefined();
    expect(response.body.paths["/api/v1/auth/me"].get).toBeDefined();
    expect(response.body.paths["/api/v1/auth/change-password"].post).toBeDefined();
  });
});
