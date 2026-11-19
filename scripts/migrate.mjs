#!/usr/bin/env node
import "dotenv/config";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const folder = join(dirname(fileURLToPath(import.meta.url)), "..", "database", "migrations");
const checkOnly = process.argv.includes("--check");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exitCode = 1;
} else {
  const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, max: 1 });
  let client;
  try {
    const entries = await readdir(folder);
    const validName = /^\d{14}_[a-z0-9_-]+\.sql$/;
    const incorrectlyNamed = entries.filter((name) => name.endsWith(".sql") && !validName.test(name));
    if (incorrectlyNamed.length > 0) {
      throw new Error("Invalid SQL migration filename(s): " + incorrectlyNamed.join(", "));
    }
    const names = entries.filter((name) => validName.test(name)).sort();
    if (names.length === 0) throw new Error("No SQL migration files found");

    client = await pool.connect();
    await client.query("BEGIN");
    // Transaction-scoped advisory lock protects against concurrent deployment runners.
    await client.query("SELECT pg_advisory_xact_lock(168456, 20261119)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const recorded = new Map((await client.query("SELECT name, checksum FROM schema_migrations")).rows
      .map((row) => [row.name, row.checksum]));
    const pending = [];

    let foundPendingMigration = false;
    for (const name of names) {
      const sql = await readFile(join(folder, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      if (recorded.has(name)) {
        if (foundPendingMigration) {
          throw new Error("Out-of-order migration detected: " + name);
        }
        if (recorded.get(name) !== checksum) {
          throw new Error("Migration checksum changed: " + name);
        }
        recorded.delete(name);
      } else {
        foundPendingMigration = true;
        pending.push({ name, checksum, sql });
      }
    }
    if (recorded.size > 0) throw new Error("Database contains migrations absent from repository");

    if (checkOnly && pending.length > 0) {
      throw new Error(pending.length + " unapplied migration(s): " + pending.map((m) => m.name).join(", "));
    }

    for (const migration of pending) {
      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [
        migration.name, migration.checksum,
      ]);
      console.log("Applied " + migration.name);
    }
    await client.query("COMMIT");
    console.log(checkOnly ? "All migrations applied and checksums valid" : "Database migrations up to date");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    console.error(error instanceof Error ? error.message : "Database migration failed");
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool.end();
  }
}
