import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import pg from "pg";

const require = createRequire(import.meta.url);
const { verifyPassword } = require("../../dist/common/crypto/password.js");
const seedScript = new URL("../../scripts/seed-demo.mjs", import.meta.url);
const databaseUrl = process.env.DATABASE_URL;

test("staging seed creates the fixture tenants once and preserves owner credentials", async () => {
  assert.ok(databaseUrl, "A dedicated migrated test database is required");
  const initialPassword = randomBytes(24).toString("base64url");
  const env = {
    ...process.env,
    APP_ENV: "staging",
    DEMO_YASMIN_OWNER_PASSWORD: initialPassword,
    DEMO_WARD_OWNER_PASSWORD: randomBytes(24).toString("base64url"),
  };
  const runSeed = (overrides) => execFileSync(process.execPath, [seedScript.pathname], {
    env: { ...env, ...overrides },
    stdio: "pipe",
  });

  assert.throws(() => runSeed({ APP_ENV: "production" }), /requires APP_ENV=staging/);
  runSeed();
  runSeed({ DEMO_YASMIN_OWNER_PASSWORD: randomBytes(24).toString("base64url") });

  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const branches = await pool.query(
      `SELECT branches.slug, restaurants.slug AS restaurant FROM branches
       JOIN restaurants ON restaurants.id = branches.restaurant_id
       WHERE restaurants.slug IN ('yasmin', 'ward') ORDER BY branches.slug`,
    );
    assert.deepEqual(branches.rows, [
      { slug: "ward-main", restaurant: "ward" },
      { slug: "yasmin-garden", restaurant: "yasmin" },
      { slug: "yasmin-main", restaurant: "yasmin" },
    ]);
    const owners = await pool.query(
      `SELECT username, role, password_hash, must_change_password, restaurants.slug AS restaurant
       FROM users JOIN restaurants ON restaurants.id = users.restaurant_id
       WHERE restaurants.slug IN ('yasmin', 'ward') ORDER BY username`,
    );
    assert.deepEqual(owners.rows.map(({ username, role, must_change_password, restaurant }) =>
      [username, role, must_change_password, restaurant]), [
      ["demo.ward.owner", "RESTAURANT_OWNER", true, "ward"],
      ["demo.yasmin.owner", "RESTAURANT_OWNER", true, "yasmin"],
    ]);
    assert.equal(await verifyPassword(initialPassword, owners.rows[1].password_hash), true);
  } finally {
    await pool.end();
  }
});
