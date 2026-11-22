#!/usr/bin/env node
/**
 * Explicit staging-only bootstrap of one platform administrator and one owner
 * per demo restaurant. Idempotent, transactional, and never resets passwords.
 * Run only against a dedicated, migrated staging database.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import pg from "pg";

const require = createRequire(import.meta.url);
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,64}$/;
const env = process.env;

function demoId(type, fixtureId) {
  return createHash("sha256").update(`restaurant-demo:${type}:${fixtureId}`).digest("hex").slice(0, 32);
}

function requirePassword(name) {
  const value = env[name];
  if (!value || value.length < 12 || value.length > 128) {
    throw new Error(`${name} must be set to a unique 12–128 character password`);
  }
  return value;
}

async function run() {
  if (env.APP_ENV !== "staging" || env.SEED_STAGING_ACCOUNTS_CONFIRM !== "yes") {
    throw new Error("Staging seed requires APP_ENV=staging and SEED_STAGING_ACCOUNTS_CONFIRM=yes");
  }
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const adminUsername = env.PRIMARY_ADMIN_USERNAME;
  if (!adminUsername || !USERNAME_PATTERN.test(adminUsername)) {
    throw new Error("PRIMARY_ADMIN_USERNAME must be 3–64 letters/numbers/._-");
  }

  const adminPassword = requirePassword("PRIMARY_ADMIN_PASSWORD");
  const ownerPasswords = new Map([
    ["yasmin", requirePassword("DEMO_YASMIN_OWNER_PASSWORD")],
    ["ward", requirePassword("DEMO_WARD_OWNER_PASSWORD")],
  ]);
  if (new Set([adminPassword, ...ownerPasswords.values()]).size !== 3) {
    throw new Error("Use different passwords for the platform admin and each restaurant owner");
  }
  const fixtures = JSON.parse(await readFile(new URL("../mocks/fixtures.json", import.meta.url), "utf8"));
  const restaurants = fixtures.restaurants.filter(({ slug }) => ownerPasswords.has(slug));
  if (restaurants.length !== ownerPasswords.size ||
      new Set(restaurants.map((item) => item.slug)).size !== ownerPasswords.size) {
    throw new Error("Expected unique yasmin and ward restaurant fixtures");
  }
  const { hashPassword } = require("../dist/common/crypto/password.js");
  const adminHash = await hashPassword(adminPassword);
  const ownerHashes = new Map();
  for (const restaurant of restaurants) {
    ownerHashes.set(restaurant.slug, await hashPassword(ownerPasswords.get(restaurant.slug)));
  }

  const client = new pg.Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  let inTransaction = false;
  try {
    await client.connect();
    await client.query("BEGIN");
    inTransaction = true;
    await client.query("SELECT pg_advisory_xact_lock(168456, 20261120)");

    const existingAdmin = await client.query(
      "SELECT username FROM users WHERE role = 'PRIMARY_ADMIN' LIMIT 1",
    );
    if (existingAdmin.rowCount > 0 && existingAdmin.rows[0].username !== adminUsername) {
      throw new Error("Another primary administrator already exists. Refusing to replace or add credentials.");
    }
    if (existingAdmin.rowCount === 0) {
      await client.query(
        `INSERT INTO users (username, display_name, password_hash, role, restaurant_id, branch_id, department, must_change_password)
         VALUES ($1, 'Primary Administrator', $2, 'PRIMARY_ADMIN', NULL, NULL, NULL, true)`,
        [adminUsername, adminHash],
      );
    }

    for (const restaurant of restaurants) {
      const restaurantId = demoId("restaurant", restaurant.id);
      const ownerId = demoId("owner", restaurant.ownerId);
      const ownerUsername = `demo.${restaurant.slug}.owner`;

      const existingRestaurant = await client.query(
        "SELECT id, slug FROM restaurants WHERE id = $1 OR slug = $2",
        [restaurantId, restaurant.slug],
      );
      if (existingRestaurant.rows.some(({ id, slug }) => id !== restaurantId || slug !== restaurant.slug)) {
        throw new Error(`Conflicting existing restaurant for ${restaurant.slug}`);
      }
      await client.query(
        `INSERT INTO restaurants (id, name, slug, is_active)
         VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
        [restaurantId, restaurant.name, restaurant.slug, restaurant.status === "active"],
      );

      const existingOwner = await client.query(
        "SELECT id, username, role, restaurant_id FROM users WHERE id = $1 OR username = $2",
        [ownerId, ownerUsername],
      );
      if (existingOwner.rows.some((user) =>
        user.id !== ownerId || user.username !== ownerUsername ||
        user.role !== "RESTAURANT_OWNER" || user.restaurant_id !== restaurantId)) {
        throw new Error(`Conflicting existing owner account for ${restaurant.slug}`);
      }
      await client.query(
        `INSERT INTO users (id, username, display_name, password_hash, role, restaurant_id, must_change_password)
         VALUES ($1, $2, $3, $4, 'RESTAURANT_OWNER', $5, true)
         ON CONFLICT (id) DO NOTHING`,
        [ownerId, ownerUsername, restaurant.name, ownerHashes.get(restaurant.slug), restaurantId],
      );

      for (const branch of fixtures.branches.filter((b) => b.restaurantId === restaurant.id)) {
        const branchId = demoId("branch", branch.id);
        const existingBranch = await client.query(
          "SELECT id, restaurant_id, slug FROM branches WHERE id = $1 OR slug = $2",
          [branchId, branch.slug],
        );
        if (existingBranch.rows.some((b) =>
          b.id !== branchId || b.restaurant_id !== restaurantId || b.slug !== branch.slug)) {
          throw new Error(`Conflicting existing branch for ${branch.slug}`);
        }
        await client.query(
          `INSERT INTO branches (id, restaurant_id, name, slug)
           VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
          [branchId, restaurantId, branch.name, branch.slug],
        );
      }
    }
    await client.query("COMMIT");
    inTransaction = false;
    console.log("Staging accounts ready: " + adminUsername + ", demo.yasmin.owner, demo.ward.owner.");
    console.log("Existing accounts were preserved; no passwords were printed or overwritten.");
  } catch (error) {
    if (inTransaction) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Staging account seed failed");
  process.exitCode = 1;
}
