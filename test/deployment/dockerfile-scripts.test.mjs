import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("production Dockerfile includes all referenced deployment scripts", async () => {
  const dockerfile = await readFile(join(root, "Dockerfile"), "utf8");
  const matches = [...dockerfile.matchAll(/COPY --from=build\s+([^\n]+)\.\/scripts\//g)];
  assert.ok(matches.length > 0, "Dockerfile must package deployment scripts");
  const paths = matches.flatMap(match => match[1].trim().split(/\s+/))
    .filter(path => path.startsWith("/app/scripts/"));
  assert.ok(paths.includes("/app/scripts/seed-complete.mjs"),
    "The complete seed must be available in the production container");
  assert.ok(!paths.some(path => /seed-demo|seed-staging-accounts/.test(path)),
    "Removed seed scripts must not be referenced by Dockerfile");
  for (const path of paths) await access(join(root, path.replace(/^\/app\//, "")));
});
