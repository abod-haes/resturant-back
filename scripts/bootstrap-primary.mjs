#!/usr/bin/env node
// One-time, manually invoked PRIMARY_ADMIN provisioner. Requires compiled backend and migrated DB.
import "dotenv/config";
import { createRequire } from "node:module";
import pg from "pg";

const require = createRequire(import.meta.url);
const { hashPassword } = require("../dist/modules/auth/domain/password.js");
const username = process.env.PRIMARY_ADMIN_USERNAME;
const password = process.env.PRIMARY_ADMIN_PASSWORD;

if (!username || !/^[A-Za-z0-9._-]{3,64}$/.test(username) || !password || password.length < 12 || password.length > 128) {
  console.error("Set PRIMARY_ADMIN_USERNAME (3–64 letters/numbers/._-) and PRIMARY_ADMIN_PASSWORD (12–128 chars) in secure runtime environment");
  process.exitCode = 1;
} else if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exitCode = 1;
} else {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  let client;
  try {
    const encoded = await hashPassword(password);
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(168456, 20261120)");
    const existing = await client.query("SELECT id FROM users WHERE role = 'PRIMARY_ADMIN' LIMIT 1");
    if (existing.rowCount !== 0) throw new Error("Primary administrator already exists; manual credential bootstrap denied");
    await client.query(
      `INSERT INTO users (username, display_name, password_hash, role, restaurant_id, branch_id, department, must_change_password)
       VALUES ($1,$2,$3,'PRIMARY_ADMIN',NULL,NULL,NULL,true)`,
      [username, "Primary Administrator", encoded],
    );
    await client.query("COMMIT");
    console.log("Primary administrator provisioned. Password change required on first login.");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    console.error(error instanceof Error ? error.message : "Primary administrator provisioning failed");
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool.end();
  }
}
