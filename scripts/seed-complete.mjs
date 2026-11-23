#!/usr/bin/env node
/**
 * Complete opt-in demo data for existing PostgreSQL; never truncates or drops data.
 * Existing restaurant IDs are always reused by slug. Existing account passwords
 * remain unchanged unless BOTH an explicit reset flag and confirmation are provided.
 */
import "dotenv/config";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import pg from "pg";
const require = createRequire(import.meta.url);
const env = process.env;
const isProduction = env.APP_ENV === "production";
const confirmation = isProduction
  ? "I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION"
  : "I_UNDERSTAND_THIS_WRITES_TO_STAGING";
if (!["production", "staging"].includes(env.APP_ENV) ||
    env.SEED_FULL_CONFIRM !== confirmation) {
  throw new Error("Set APP_ENV=production|staging and SEED_FULL_CONFIRM=" + confirmation);
}
if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!/^[a-fA-F0-9]{64}$/.test(env.QR_TOKEN_ENCRYPTION_KEY ?? "")) {
  throw new Error("Set the existing Backend QR_TOKEN_ENCRYPTION_KEY (64 hex chars), never expose it to a frontend.");
}
const reset = process.argv.includes("--reset-demo-passwords");
const dryRun = process.argv.includes("--dry-run");
if (process.argv.some(arg => arg.startsWith("--") && !["--reset-demo-passwords", "--dry-run"].includes(arg))) {
  throw new Error("Unknown option. Supported: --dry-run and --reset-demo-passwords");
}
if (reset && env.SEED_RESET_DEMO_PASSWORDS_CONFIRM !== "RESET_ONLY_NAMED_DEMO_ACCOUNTS") {
  throw new Error("Password reset requires SEED_RESET_DEMO_PASSWORDS_CONFIRM=RESET_ONLY_NAMED_DEMO_ACCOUNTS");
}
const qrKey = Buffer.from(env.QR_TOKEN_ENCRYPTION_KEY, "hex");
const { hashPassword } = require("../dist/common/crypto/password.js");
const menu = [
  ["مشروبات ساخنة", [
    ["قهوة عربية", "قهوة عربية محضرة طازجة", 250],
    ["كابتشينو", "إسبريسو مع حليب ورغوة", 350],
    ["شاي بالنعناع", "شاي طازج مع نعناع", 180],
    ["هوت شوكليت", "شوكولاتة ساخنة مع الحليب", 320],
  ]],
  ["مشروبات باردة", [
    ["ليمون بالنعناع", "ليمون طازج ونعناع", 300],
    ["عصير برتقال", "عصير برتقال طبيعي", 320],
    ["آيس لاتيه", "قهوة باردة مع الحليب", 370],
    ["موهيتو فراولة", "شراب فراولة منعش", 390],
  ]],
  ["وجبات رئيسية", [
    ["برغر لحم", "برغر مشوي مع الخضار والبطاطا", 950],
    ["شاورما دجاج", "سندويش شاورما مع المخلل", 620],
    ["بيتزا مارغريتا", "بيتزا بالجبنة والطماطم", 1050],
    ["باستا ألفريدو", "معكرونة بصلصة الكريمة", 1120],
  ]],
  ["حلويات", [
    ["تشيز كيك", "قطعة تشيز كيك بالفراولة", 580],
    ["كيك شوكولا", "كيك شوكولاتة غنية", 520],
    ["كنافة", "كنافة ساخنة بالجبنة", 490],
    ["آيس كريم", "ثلاث كرات آيس كريم", 410],
  ]],
];
const restaurants = [
  { slug: "yasmin", name: "مطعم الياسمين", branch: "yasmin-main",
    owner: "demo.yasmin.owner", employees: [
      ["demo.yasmin.waiter", "أحمد - غارسون", "waiter"],
      ["demo.yasmin.hookah", "خالد - أراكيل", "hookah"],
    ] },
  { slug: "ward", name: "مطعم الورد", branch: "ward-main",
    owner: "demo.ward.owner", employees: [
      ["demo.ward.waiter", "سامر - غارسون", "waiter"],
      ["demo.ward.hookah", "مازن - أراكيل", "hookah"],
    ] },
];
const snapshot = {
  maxBranches: 5, maxTables: 100, maxEmployees: 30,
  features: { menu: true, waiter_calls: true, hookah_calls: true, analytics: true },
};
const generated = [];
const summary = { restaurants: 0, branches: 0, categories: 0, products: 0,
  floors: 0, areas: 0, tables: 0, qrCredentials: 0, users: 0, subscriptions: 0 };
const uniquePassword = () => randomBytes(15).toString("base64url");
function newTokenCredential(token) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", qrKey, nonce);
  const bytes = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const box = [nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"),
    bytes.toString("base64url")].join(".");
  return [createHash("sha256").update(token).digest("hex"), box];
}
async function single(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0] ?? null;
}
async function ensureUser(client, username, displayName, role, restaurantId = null, branchId = null, department = null) {
  const existing = await single(client, "SELECT id,role,restaurant_id,branch_id,department FROM users WHERE lower(username)=lower($1) FOR UPDATE", [username]);
  if (existing && (existing.role !== role || existing.restaurant_id !== restaurantId ||
      existing.branch_id !== branchId || existing.department !== department)) {
    throw new Error("Account already belongs to a different scope: " + username);
  }
  if (existing && !reset) return existing.id;
  // Allow explicit per-account secrets via transient env, otherwise generate strong one-time secrets.
  const envName = "SEED_PASSWORD_" + username.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const password = env[envName] || uniquePassword();
  if (password.length < 12 || password.length > 128) throw new Error("Invalid password length for " + username);
  const hash = await hashPassword(password);
  let id;
  if (existing) {
    id = existing.id;
    await client.query("UPDATE users SET password_hash=$2,must_change_password=true WHERE id=$1", [id,hash]);
    await client.query("UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [id]);
  } else {
    id = (await single(client, `INSERT INTO users
      (username,display_name,password_hash,role,restaurant_id,branch_id,department,must_change_password)
      VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING id`,
      [username,displayName,hash,role,restaurantId,branchId,department])).id;
    summary.users++;
  }
  generated.push({ username, password, action: existing ? "reset" : "created" });
  return id;
}
async function ensureRestaurant(client, restaurant) {
  const current = await single(client, "SELECT id FROM restaurants WHERE slug=$1 FOR UPDATE", [restaurant.slug]);
  if (current) return current.id;
  summary.restaurants++;
  return (await single(client,
    "INSERT INTO restaurants(name,slug,is_active) VALUES($1,$2,true) RETURNING id",
    [restaurant.name,restaurant.slug])).id;
}
async function ensureBranch(client, restaurantId, slug) {
  const row = await single(client, "SELECT id,restaurant_id FROM branches WHERE slug=$1 FOR UPDATE", [slug]);
  if (row) {
    if (row.restaurant_id !== restaurantId) throw new Error("Branch belongs to another restaurant: " + slug);
    return row.id;
  }
  summary.branches++;
  return (await single(client,
    "INSERT INTO branches(restaurant_id,name,slug,currency,is_active) VALUES($1,$2,$3,'USD',true) RETURNING id",
    [restaurantId,"الفرع الرئيسي",slug])).id;
}
async function ensureByName(client, table, scopeColumn, scopeId, name, extraColumns, extras) {
  const row = await single(client,
    `SELECT id FROM ${table} WHERE ${scopeColumn}=$1 AND lower(name)=lower($2) AND archived_at IS NULL FOR UPDATE`,
    [scopeId,name]);
  if (row) return row.id;
  const columns = [scopeColumn,"name",...extraColumns];
  const placeholders = columns.map((_,i) => "$" + (i+1));
  const values = [scopeId,name,...extras];
  const created = await single(client,
    `INSERT INTO ${table} (${columns.join(",")}) VALUES(${placeholders.join(",")}) RETURNING id`, values);
  summary[table]++;
  return created.id;
}
async function ensureSubscription(client, restaurantId, planId, adminId) {
  const existing = await single(client,
    "SELECT id,starts_at,grace_ends_at,entitlement_snapshot FROM subscriptions WHERE restaurant_id=$1 AND status='active' FOR UPDATE", [restaurantId]);
  if (existing) {
    const ent = existing.entitlement_snapshot;
    const active = existing.starts_at && existing.grace_ends_at
      && new Date(existing.starts_at) <= new Date()
      && new Date(existing.grace_ends_at) > new Date()
      && ent?.features?.menu === true
      && ent?.features?.waiter_calls === true
      && ent?.features?.hookah_calls === true
      && ent?.maxTables >= 5 && ent?.maxEmployees >= 2;
    if (!active) throw new Error("Existing active subscription does not support full demo; resolve its entitlements in Admin Dashboard.");
    return; // Never overwrite existing terms.
  }
  const start = new Date();
  const end = new Date(start);
  end.setUTCFullYear(end.getUTCFullYear()+1);
  const grace = new Date(end.getTime()+7*86400_000);
  const entitlement = JSON.stringify(snapshot);
  const row = await single(client, `INSERT INTO subscriptions
    (restaurant_id,plan_id,period,status,starts_at,ends_at,grace_ends_at,grace_days,
     entitlement_snapshot,activated_by_user_id)
    VALUES($1,$2,'yearly','active',$3,$4,$5,7,$6::jsonb,$7) RETURNING id`,
    [restaurantId,planId,start,end,grace,entitlement,adminId]);
  await client.query(`INSERT INTO subscription_terms
    (subscription_id,sequence,plan_id,period,starts_at,ends_at,grace_ends_at,entitlement_snapshot,activated_by_user_id)
    VALUES($1,1,$2,'yearly',$3,$4,$5,$6::jsonb,$7)`,
    [row.id,planId,start,end,grace,entitlement,adminId]);
  summary.subscriptions++;
}
async function ensureTable(client, restaurantId, branchId, areaId, label, order) {
  const old = await single(client, `SELECT id,area_id,qr_version FROM restaurant_tables
    WHERE branch_id=$1 AND lower(label)=lower($2) AND archived_at IS NULL FOR UPDATE`,[branchId,label]);
  if (old && old.area_id !== areaId) {
    throw new Error("Existing table located in a different area: " + label);
  }
  let row = old;
  if (!row) {
    row = await single(client, `INSERT INTO restaurant_tables
      (restaurant_id,branch_id,area_id,label,sort_order,is_active,qr_enabled,calls_enabled)
      VALUES($1,$2,$3,$4,$5,true,true,true) RETURNING id,qr_version`,
      [restaurantId,branchId,areaId,label,order]);
    summary.tables++;
  }
  const credential = await single(client,
    "SELECT id FROM qr_credentials WHERE table_id=$1 AND revoked_at IS NULL", [row.id]);
  if (!credential) {
    const oldCredential = await single(client,
      "SELECT id FROM qr_credentials WHERE table_id=$1 LIMIT 1", [row.id]);
    if (oldCredential) throw new Error("QR was revoked for table " + label + "; rotate it from Restaurant Dashboard instead.");
    const token = randomBytes(32).toString("base64url");
    const [tokenHash,box] = newTokenCredential(token);
    await client.query(`INSERT INTO qr_credentials
      (table_id,branch_id,version,token_hash,token_box)
      VALUES($1,$2,$3,$4,$5)`,[row.id,branchId,row.qr_version,tokenHash,box]);
    summary.qrCredentials++;
  }
}
async function run() {
  const client = new pg.Client({ connectionString:env.DATABASE_URL, connectionTimeoutMillis:5000 });
  let transaction = false;
  try {
    await client.connect();
    await client.query("BEGIN");
    transaction = true;
    await client.query("SELECT pg_advisory_xact_lock(168456,20261120)");
    const existingAdmins = await client.query("SELECT username FROM users WHERE role='PRIMARY_ADMIN'");
    if (existingAdmins.rows.some(x => x.username !== "platform.admin"))
      throw new Error("Another primary administrator exists; refusing a competing admin.");
    const adminId = await ensureUser(client,"platform.admin","مدير النظام","PRIMARY_ADMIN");
    let plan = await single(client,"SELECT id FROM plans WHERE name=$1 FOR UPDATE",["باقة المعاينة الكاملة"]);
    if (!plan) {
      plan = await single(client,`INSERT INTO plans
        (name,max_branches,max_tables,max_employees,features,is_active)
        VALUES($1,$2,$3,$4,$5::jsonb,true) RETURNING id`,
        ["باقة المعاينة الكاملة",snapshot.maxBranches,snapshot.maxTables,snapshot.maxEmployees,
          JSON.stringify(snapshot.features)]);
    }
    for (const restaurant of restaurants) {
      const restaurantId = await ensureRestaurant(client,restaurant);
      const branchId = await ensureBranch(client,restaurantId,restaurant.branch);
      await ensureUser(client,restaurant.owner,restaurant.name+" - المالك","RESTAURANT_OWNER",restaurantId);
      for (const [username,displayName,department] of restaurant.employees) {
        await ensureUser(client,username,displayName,"EMPLOYEE",restaurantId,branchId,department);
      }
      await ensureSubscription(client,restaurantId,plan.id,adminId);
      await client.query(`INSERT INTO restaurant_call_settings
        (restaurant_id,enabled,waiter_enabled,hookah_enabled,routing_mode)
        VALUES($1,true,true,true,'department_on_shift') ON CONFLICT(restaurant_id) DO NOTHING`,[restaurantId]);
      await client.query(`INSERT INTO branch_call_settings
        (branch_id,enabled,waiter_enabled,hookah_enabled,routing_mode)
        VALUES($1,true,true,true,'department_on_shift') ON CONFLICT(branch_id) DO NOTHING`,[branchId]);
      const floorId = await ensureByName(client,"floors","branch_id",branchId,"الأرضي",
        ["restaurant_id","sort_order"],[restaurantId,0]);
      const areaId = await ensureByName(client,"areas","floor_id",floorId,"داخلي",
        ["restaurant_id","branch_id","sort_order"],[restaurantId,branchId,0]);
      for(let n=1;n<=5;n++) await ensureTable(client,restaurantId,branchId,areaId,String(n),n);
      let catOrder = 0;
      for(const [categoryName,items] of menu) {
        const categoryId=await ensureByName(client,"categories","branch_id",branchId,categoryName,
          ["restaurant_id","sort_order"],[restaurantId,catOrder++]);
        let productOrder=0;
        for(const [name,description,price] of items) {
          const old = await single(client,`SELECT id FROM products
            WHERE branch_id=$1 AND category_id=$2 AND name=$3 AND archived_at IS NULL
            FOR UPDATE`,[branchId,categoryId,name]);
          if(old) continue;
          await client.query(`INSERT INTO products
            (restaurant_id,branch_id,category_id,name,description,price_minor,currency,
             sort_order,is_visible,is_sold_out)
            VALUES($1,$2,$3,$4,$5,$6,'USD',$7,true,false)`,
            [restaurantId,branchId,categoryId,name,description,price,productOrder++]);
          summary.products++;
        }
      }
    }
    await client.query(dryRun ? "ROLLBACK" : "COMMIT");
    transaction=false;
    console.log(dryRun ? "DRY RUN successful: all changes rolled back." : "Seed completed successfully (only absent rows created).");
    console.table(summary);
    if (generated.length && !dryRun) {
      console.log("ONE-TIME CREDENTIALS - store privately now; never post or commit:");
      console.table(generated);
      console.log("Existing credentials not listed above were preserved.");
    } else if (!dryRun) {
      console.log("All accounts already exist; passwords unchanged. For intentional demo-account rotation, use --reset-demo-passwords with separate confirmation.");
    }
  } catch(error) {
    if(transaction) await client.query("ROLLBACK").catch(()=>{});
    throw error;
  } finally { await client.end().catch(()=>{}); }
}
run().catch(error => { console.error(error instanceof Error?error.message:"Seed failed");process.exitCode=1; });
