import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

describe("core database constraints", () => {
  let pool: Pool;
  let client: PoolClient;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    client = await pool.connect();
    await client.query("BEGIN");
  });

  afterAll(async () => {
    if (client) {
      await client.query("ROLLBACK");
      client.release();
    }
    if (pool) await pool.end();
  });

  async function expectedError(statement: string, values: unknown[], code: string): Promise<void> {
    await client.query("SAVEPOINT expected_constraint_violation");
    try {
      await expect(client.query(statement, values)).rejects.toMatchObject({ code });
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT expected_constraint_violation");
      await client.query("RELEASE SAVEPOINT expected_constraint_violation");
    }
  }

  async function createRestaurant(): Promise<string> {
    const result = await client.query<{ id: string }>(
      "INSERT INTO restaurants (name, slug) VALUES ($1, $2) RETURNING id",
      ["Test restaurant", "restaurant-" + randomUUID()],
    );
    return result.rows[0].id;
  }

  async function createBranch(restaurantId: string): Promise<string> {
    const result = await client.query<{ id: string }>(
      "INSERT INTO branches (restaurant_id, name, slug) VALUES ($1, $2, $3) RETURNING id",
      [restaurantId, "Branch", "branch-" + randomUUID()],
    );
    return result.rows[0].id;
  }

  async function createUser(args: {
    role: string;
    restaurantId?: string | null;
    branchId?: string | null;
    department?: string | null;
    username?: string;
  }): Promise<string> {
    const username = args.username ?? "user_" + randomUUID().replaceAll("-", "");
    const result = await client.query<{ id: string }>(
      `INSERT INTO users (username, display_name, password_hash, role, restaurant_id, branch_id, department)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [username, "Test user", "hash:not-a-production-secret-xxxxxxxxxxxxxxxxxxxxxxxx", args.role,
        args.restaurantId ?? null, args.branchId ?? null, args.department ?? null],
    );
    return result.rows[0].id;
  }

  it("prevents case-insensitive username duplication", async () => {
    const restaurantId = await createRestaurant();
    const username = "Test_" + randomUUID().replaceAll("-", "");
    await createUser({ role: "RESTAURANT_OWNER", restaurantId, username });
    await expectedError(
      `INSERT INTO users (username, display_name, password_hash, role, restaurant_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [username.toUpperCase(), "Duplicate", "hash:not-a-production-secret-xxxxxxxxxxxxxxxxxxxxxxxx",
        "RESTAURANT_OWNER", restaurantId],
      "23505",
    );
  });

  it("enforces one owner per restaurant", async () => {
    const restaurantId = await createRestaurant();
    await createUser({ role: "RESTAURANT_OWNER", restaurantId });
    await expectedError(
      `INSERT INTO users (username, display_name, password_hash, role, restaurant_id)
       VALUES ($1,$2,$3,$4,$5)`,
      ["user_" + randomUUID().replaceAll("-", ""), "Another owner",
        "hash:not-a-production-secret-xxxxxxxxxxxxxxxxxxxxxxxx", "RESTAURANT_OWNER", restaurantId],
      "23505",
    );
  });

  it("prevents assigning an employee to another restaurant's branch", async () => {
    const restaurantA = await createRestaurant();
    const restaurantB = await createRestaurant();
    const branchB = await createBranch(restaurantB);
    await expectedError(
      `INSERT INTO users (username, display_name, password_hash, role, restaurant_id, branch_id, department)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      ["user_" + randomUUID().replaceAll("-", ""), "Spoofed employee",
        "hash:not-a-production-secret-xxxxxxxxxxxxxxxxxxxxxxxx",
        "EMPLOYEE", restaurantA, branchB, "waiter"],
      "23503",
    );
  });

  it("requires scoped employee role and validates department", async () => {
    const restaurantId = await createRestaurant();
    const branchId = await createBranch(restaurantId);
    await createUser({ role: "EMPLOYEE", restaurantId, branchId, department: "hookah" });
    await expectedError(
      `INSERT INTO users (username, display_name, password_hash, role, restaurant_id, branch_id, department)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      ["user_" + randomUUID().replaceAll("-", ""), "Invalid employee",
        "hash:not-a-production-secret-xxxxxxxxxxxxxxxxxxxxxxxx",
        "EMPLOYEE", restaurantId, branchId, "cashier"],
      "23514",
    );
  });

  it("rejects employees without a department", async () => {
    const restaurantId = await createRestaurant();
    const branchId = await createBranch(restaurantId);
    await expectedError(
      `INSERT INTO users (username, display_name, password_hash, role, restaurant_id, branch_id, department)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      ["user_" + randomUUID().replaceAll("-", ""), "Incomplete employee",
        "hash:not-a-production-secret-xxxxxxxxxxxxxxxxxxxxxxxx",
        "EMPLOYEE", restaurantId, branchId, null],
      "23514",
    );
  });

  it("requires a valid subscription interval and prevents two active subscriptions", async () => {
    const restaurantId = await createRestaurant();
    const plan = await client.query<{ id: string }>(
      `INSERT INTO plans (name,max_branches,max_tables,max_employees,features)
       VALUES ($1,1,50,10,'{}'::jsonb) RETURNING id`,
      ["Test plan " + randomUUID()],
    );
    const startsAt = new Date("2026-11-01T00:00:00.000Z");
    const endsAt = new Date("2026-12-01T00:00:00.000Z");
    await client.query(
      `INSERT INTO subscriptions (restaurant_id,plan_id,period,status,starts_at,ends_at)
       VALUES ($1,$2,'monthly','active',$3,$4)`,
      [restaurantId,plan.rows[0].id,startsAt,endsAt],
    );
    await expectedError(
      `INSERT INTO subscriptions (restaurant_id,plan_id,period,status,starts_at,ends_at)
       VALUES ($1,$2,'monthly','active',$3,$4)`,
      [restaurantId,plan.rows[0].id,startsAt,endsAt],
      "23505",
    );
    await expectedError(
      `INSERT INTO subscriptions (restaurant_id,plan_id,period,status,starts_at,ends_at)
       VALUES ($1,$2,'monthly','active',$3,$4)`,
      [await createRestaurant(),plan.rows[0].id,endsAt,startsAt],
      "23514",
    );
  });

  it("does not allow platform administrators to carry restaurant scope", async () => {
    const restaurantId = await createRestaurant();
    await expectedError(
      `INSERT INTO users (username,display_name,password_hash,role,restaurant_id)
       VALUES ($1,$2,$3,$4,$5)`,
      ["user_" + randomUUID().replaceAll("-", ""), "Platform admin",
        "hash:not-a-production-secret-xxxxxxxxxxxxxxxxxxxxxxxx", "PLATFORM_ADMIN", restaurantId],
      "23514",
    );
  });
});
