import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import pg from "pg";

const require = createRequire(import.meta.url);

function demoId(type, fixtureId) {
  return createHash("sha256").update(`restaurant-demo:${type}:${fixtureId}`).digest("hex").slice(0, 32);
}

async function seedDemo() {
  const { APP_ENV, DATABASE_URL, DEMO_YASMIN_OWNER_PASSWORD, DEMO_WARD_OWNER_PASSWORD } = process.env;
  if (APP_ENV !== "staging") throw new Error("Demo seed requires APP_ENV=staging");
  if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

  const passwordsBySlug = new Map([
    ["yasmin", DEMO_YASMIN_OWNER_PASSWORD],
    ["ward", DEMO_WARD_OWNER_PASSWORD],
  ]);
  const { hashPassword } = require("../dist/common/crypto/password.js");
  const fixtures = JSON.parse(await readFile(new URL("../mocks/fixtures.json", import.meta.url), "utf8"));
  const restaurants = fixtures.restaurants.filter(({ slug }) => passwordsBySlug.has(slug));
  if (restaurants.length !== passwordsBySlug.size) throw new Error("Expected demo restaurants are missing");

  const owners = new Map();
  for (const restaurant of restaurants) {
    const password = passwordsBySlug.get(restaurant.slug);
    if (!password || password.length < 12 || password.length > 128) {
      throw new Error(`Set a 12–128 character demo owner password for ${restaurant.slug}`);
    }
    owners.set(restaurant.id, await hashPassword(password));
  }

  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query("BEGIN");

    for (const restaurant of restaurants) {
      const restaurantId = demoId("restaurant", restaurant.id);
      await client.query(
        `INSERT INTO restaurants (id, name, slug, is_active) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [restaurantId, restaurant.name, restaurant.slug, restaurant.status === "active"],
      );
      await client.query(
        `INSERT INTO users (id, username, display_name, password_hash, role, restaurant_id, must_change_password)
         VALUES ($1, $2, $3, $4, 'RESTAURANT_OWNER', $5, true)
         ON CONFLICT (id) DO NOTHING`,
        [demoId("owner", restaurant.ownerId), `demo.${restaurant.slug}.owner`,
          restaurant.name, owners.get(restaurant.id), restaurantId],
      );
      for (const branch of fixtures.branches.filter(({ restaurantId }) => restaurantId === restaurant.id)) {
        await client.query(
          `INSERT INTO branches (id, restaurant_id, name, slug) VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO NOTHING`,
          [demoId("branch", branch.id), restaurantId, branch.name, branch.slug],
        );
      }
    }

    await client.query("COMMIT");
    console.log("Demo restaurants, branches and owners are ready.");
  } finally {
    // Closing the connection also rolls back an uncommitted seed on failure.
    await client.end();
  }
}

try {
  await seedDemo();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Demo seed failed");
  process.exitCode = 1;
}
