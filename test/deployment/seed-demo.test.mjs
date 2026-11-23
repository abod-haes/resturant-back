import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import pg from "pg";

const require = createRequire(import.meta.url);
const { verifyPassword } = require("../../dist/common/crypto/password.js");
const seedScript = new URL("../../scripts/seed-complete.mjs", import.meta.url);
const databaseUrl = process.env.DATABASE_URL;
const confirmation = "I_UNDERSTAND_THIS_WRITES_TO_STAGING";

test("complete seed creates QR, meals and staff once and keeps existing passwords", async () => {
  assert.ok(databaseUrl, "A dedicated migrated test database is required");
  const initialPassword = randomBytes(20).toString("base64url");
  const env = {
    ...process.env, APP_ENV: "staging", SEED_FULL_CONFIRM: confirmation,
    SEED_PASSWORD_DEMO_YASMIN_OWNER: initialPassword,
  };
  const runSeed = (args = [], overrides = {}) =>
    execFileSync(process.execPath, [seedScript.pathname, ...args], {
      env: { ...env, ...overrides }, stdio: "pipe", encoding: "utf8",
    });
  assert.throws(() => runSeed([], { APP_ENV: "production" }), /SEED_FULL_CONFIRM/);
  assert.match(runSeed(["--dry-run"]), /DRY RUN successful/);

  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const before = await pool.query("SELECT count(*)::int AS total FROM restaurants WHERE slug IN ('yasmin','ward')");
    assert.equal(before.rows[0].total, 0, "Dry-run must not persist demo restaurants");
    runSeed();
    runSeed([], { SEED_PASSWORD_DEMO_YASMIN_OWNER: randomBytes(20).toString("base64url") });

    const owners = await pool.query(`SELECT username,password_hash FROM users
      WHERE username IN ('demo.yasmin.owner','demo.ward.owner') ORDER BY username`);
    assert.equal(owners.rowCount, 2);
    const yasmin = owners.rows.find(row => row.username === "demo.yasmin.owner");
    assert.equal(await verifyPassword(initialPassword, yasmin.password_hash), true,
      "Rerun must preserve existing credentials");

    const employee = await pool.query(`SELECT count(*)::int AS total FROM users
      WHERE role='EMPLOYEE' AND username LIKE 'demo.%'`);
    assert.equal(employee.rows[0].total, 4);
    const branches = await pool.query(`SELECT count(*)::int AS total FROM branches
      WHERE slug IN ('yasmin-main','ward-main')`);
    assert.equal(branches.rows[0].total, 2);

    const products = await pool.query(`SELECT count(*)::int AS total FROM products
      WHERE branch_id IN (SELECT id FROM branches WHERE slug IN ('yasmin-main','ward-main'))`);
    assert.equal(products.rows[0].total, 32);
    const tables = await pool.query(`SELECT count(*)::int AS total FROM restaurant_tables
      WHERE branch_id IN (SELECT id FROM branches WHERE slug IN ('yasmin-main','ward-main'))`);
    assert.equal(tables.rows[0].total, 10);
    const qr = await pool.query(`SELECT count(*)::int AS total FROM qr_credentials
      WHERE table_id IN (SELECT id FROM restaurant_tables
      WHERE branch_id IN (SELECT id FROM branches WHERE slug IN ('yasmin-main','ward-main')))
      AND revoked_at IS NULL`);
    assert.equal(qr.rows[0].total, 10);
  } finally {
    await pool.end();
  }
});
