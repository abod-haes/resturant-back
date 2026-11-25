#!/usr/bin/env node
/** Explicit destructive demo reset; never run automatically. */
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
const reset = false;
const logoUrl = env.SEED_JUBRAN_LOGO_URL || null;
if (logoUrl && (new URL(logoUrl).protocol !== "https:" || new URL(logoUrl).username || new URL(logoUrl).password || logoUrl.length > 2048)) throw new Error("Invalid HTTPS logo URL");
if (env.SEED_REPLACE_CONFIRM !== "DELETE_ALL_RESTAURANT_DATA") throw new Error("Explicit replacement confirmation required");
const dryRun = process.argv.includes("--dry-run");
if (process.argv.some(arg => arg.startsWith("--") && !["--dry-run"].includes(arg))) {
  throw new Error("Unknown option. Supported: --dry-run");
}
if (reset && env.SEED_RESET_DEMO_PASSWORDS_CONFIRM !== "RESET_ONLY_NAMED_DEMO_ACCOUNTS") {
  throw new Error("Password reset requires SEED_RESET_DEMO_PASSWORDS_CONFIRM=RESET_ONLY_NAMED_DEMO_ACCOUNTS");
}
const qrKey = Buffer.from(env.QR_TOKEN_ENCRYPTION_KEY, "hex");
const { hashPassword } = require("../dist/common/crypto/password.js");
// Illustrative demo menu, not verified restaurant prices.
const menu = [
  [
    "الفطور",
    [
      [
        "فطور جبران",
        "صنف تجريبي — الفطور",
        65000
      ],
      [
        "بيض مقلي",
        "صنف تجريبي — الفطور",
        25000
      ],
      [
        "بيض باللحمة",
        "صنف تجريبي — الفطور",
        45000
      ],
      [
        "فول",
        "صنف تجريبي — الفطور",
        25000
      ],
      [
        "فتة حمص",
        "صنف تجريبي — الفطور",
        35000
      ],
      [
        "مناقيش زعتر",
        "صنف تجريبي — الفطور",
        15000
      ],
      [
        "جبنة مشوية",
        "صنف تجريبي — الفطور",
        30000
      ],
      [
        "لبنة",
        "صنف تجريبي — الفطور",
        22000
      ]
    ]
  ],
  [
    "المقبلات الباردة",
    [
      [
        "حمص",
        "صنف تجريبي — المقبلات الباردة",
        25000
      ],
      [
        "متبل",
        "صنف تجريبي — المقبلات الباردة",
        25000
      ],
      [
        "بابا غنوج",
        "صنف تجريبي — المقبلات الباردة",
        28000
      ],
      [
        "محمرة حلبية",
        "صنف تجريبي — المقبلات الباردة",
        30000
      ],
      [
        "ورق عنب",
        "صنف تجريبي — المقبلات الباردة",
        35000
      ],
      [
        "لبنة بالثوم",
        "صنف تجريبي — المقبلات الباردة",
        22000
      ],
      [
        "مخللات",
        "صنف تجريبي — المقبلات الباردة",
        15000
      ],
      [
        "حمص باللحمة",
        "صنف تجريبي — المقبلات الباردة",
        45000
      ]
    ]
  ],
  [
    "المقبلات الساخنة",
    [
      [
        "كبة مقلية",
        "صنف تجريبي — المقبلات الساخنة",
        45000
      ],
      [
        "سمبوسك جبنة",
        "صنف تجريبي — المقبلات الساخنة",
        30000
      ],
      [
        "سمبوسك لحمة",
        "صنف تجريبي — المقبلات الساخنة",
        35000
      ],
      [
        "بطاطا مقلية",
        "صنف تجريبي — المقبلات الساخنة",
        20000
      ],
      [
        "بطاطا حارة",
        "صنف تجريبي — المقبلات الساخنة",
        25000
      ],
      [
        "جوانح دجاج",
        "صنف تجريبي — المقبلات الساخنة",
        40000
      ],
      [
        "سجق",
        "صنف تجريبي — المقبلات الساخنة",
        45000
      ]
    ]
  ],
  [
    "السلطات",
    [
      [
        "فتوش",
        "صنف تجريبي — السلطات",
        25000
      ],
      [
        "تبولة",
        "صنف تجريبي — السلطات",
        25000
      ],
      [
        "سلطة خضراء",
        "صنف تجريبي — السلطات",
        20000
      ],
      [
        "سلطة سيزر",
        "صنف تجريبي — السلطات",
        40000
      ],
      [
        "سلطة جرجير",
        "صنف تجريبي — السلطات",
        28000
      ],
      [
        "سلطة يونانية",
        "صنف تجريبي — السلطات",
        35000
      ]
    ]
  ],
  [
    "المشاوي",
    [
      [
        "كباب حلبي",
        "صنف تجريبي — المشاوي",
        95000
      ],
      [
        "كباب بالكرز",
        "صنف تجريبي — المشاوي",
        120000
      ],
      [
        "شيش طاووق",
        "صنف تجريبي — المشاوي",
        80000
      ],
      [
        "شقف لحم",
        "صنف تجريبي — المشاوي",
        110000
      ],
      [
        "مشاوي مشكلة",
        "صنف تجريبي — المشاوي",
        135000
      ],
      [
        "كباب خشخاش",
        "صنف تجريبي — المشاوي",
        100000
      ],
      [
        "ريش غنم",
        "صنف تجريبي — المشاوي",
        145000
      ],
      [
        "فروج مشوي",
        "صنف تجريبي — المشاوي",
        125000
      ]
    ]
  ],
  [
    "الكبب",
    [
      [
        "كبة مشوية",
        "صنف تجريبي — الكبب",
        50000
      ],
      [
        "كبة بالصينية",
        "صنف تجريبي — الكبب",
        60000
      ],
      [
        "كبة لبنية",
        "صنف تجريبي — الكبب",
        80000
      ],
      [
        "كبة سماقية",
        "صنف تجريبي — الكبب",
        85000
      ],
      [
        "كبة نية",
        "صنف تجريبي — الكبب",
        65000
      ]
    ]
  ],
  [
    "الوجبات الغربية",
    [
      [
        "برغر لحم",
        "صنف تجريبي — الوجبات الغربية",
        45000
      ],
      [
        "برغر دجاج",
        "صنف تجريبي — الوجبات الغربية",
        40000
      ],
      [
        "كريسبي",
        "صنف تجريبي — الوجبات الغربية",
        40000
      ],
      [
        "فاهيتا",
        "صنف تجريبي — الوجبات الغربية",
        45000
      ],
      [
        "اسكالوب دجاج",
        "صنف تجريبي — الوجبات الغربية",
        75000
      ],
      [
        "كوردون بلو",
        "صنف تجريبي — الوجبات الغربية",
        95000
      ],
      [
        "باستا ألفريدو",
        "صنف تجريبي — الوجبات الغربية",
        65000
      ],
      [
        "ستيك دجاج",
        "صنف تجريبي — الوجبات الغربية",
        85000
      ]
    ]
  ],
  [
    "البيتزا والمعجنات",
    [
      [
        "مارغريتا",
        "صنف تجريبي — البيتزا والمعجنات",
        50000
      ],
      [
        "بيتزا خضار",
        "صنف تجريبي — البيتزا والمعجنات",
        55000
      ],
      [
        "بيتزا دجاج",
        "صنف تجريبي — البيتزا والمعجنات",
        65000
      ],
      [
        "بيتزا بيبروني",
        "صنف تجريبي — البيتزا والمعجنات",
        70000
      ],
      [
        "بيتزا مشكلة",
        "صنف تجريبي — البيتزا والمعجنات",
        75000
      ],
      [
        "مناقيش جبنة",
        "صنف تجريبي — البيتزا والمعجنات",
        25000
      ],
      [
        "صفيحة",
        "صنف تجريبي — البيتزا والمعجنات",
        35000
      ]
    ]
  ],
  [
    "الحلويات",
    [
      [
        "كنافة",
        "صنف تجريبي — الحلويات",
        35000
      ],
      [
        "بقلاوة",
        "صنف تجريبي — الحلويات",
        40000
      ],
      [
        "بوظة عربية",
        "صنف تجريبي — الحلويات",
        30000
      ],
      [
        "تشيز كيك",
        "صنف تجريبي — الحلويات",
        35000
      ],
      [
        "كيك شوكولا",
        "صنف تجريبي — الحلويات",
        35000
      ]
    ]
  ],
  [
    "المشروبات الساخنة",
    [
      [
        "قهوة تركية",
        "صنف تجريبي — المشروبات الساخنة",
        12000
      ],
      [
        "شاي",
        "صنف تجريبي — المشروبات الساخنة",
        8000
      ],
      [
        "إسبريسو",
        "صنف تجريبي — المشروبات الساخنة",
        15000
      ],
      [
        "كابتشينو",
        "صنف تجريبي — المشروبات الساخنة",
        22000
      ],
      [
        "لاتيه",
        "صنف تجريبي — المشروبات الساخنة",
        22000
      ],
      [
        "هوت شوكليت",
        "صنف تجريبي — المشروبات الساخنة",
        25000
      ]
    ]
  ],
  [
    "المشروبات الباردة والعصائر",
    [
      [
        "عصير برتقال",
        "صنف تجريبي — المشروبات الباردة والعصائر",
        20000
      ],
      [
        "ليمون ونعناع",
        "صنف تجريبي — المشروبات الباردة والعصائر",
        20000
      ],
      [
        "كوكتيل فواكه",
        "صنف تجريبي — المشروبات الباردة والعصائر",
        30000
      ],
      [
        "موهيتو",
        "صنف تجريبي — المشروبات الباردة والعصائر",
        25000
      ],
      [
        "آيس لاتيه",
        "صنف تجريبي — المشروبات الباردة والعصائر",
        25000
      ],
      [
        "مياه معدنية",
        "صنف تجريبي — المشروبات الباردة والعصائر",
        5000
      ]
    ]
  ],
  [
    "الأراكيل",
    [
      [
        "تفاحتين",
        "صنف تجريبي — الأراكيل",
        40000
      ],
      [
        "عنب ونعناع",
        "صنف تجريبي — الأراكيل",
        40000
      ],
      [
        "ليمون ونعناع",
        "صنف تجريبي — الأراكيل",
        40000
      ],
      [
        "نعناع",
        "صنف تجريبي — الأراكيل",
        40000
      ],
      [
        "بطيخ ونعناع",
        "صنف تجريبي — الأراكيل",
        45000
      ],
      [
        "أركيلة مميزة",
        "صنف تجريبي — الأراكيل",
        55000
      ]
    ]
  ]
];
const restaurants = [
  {
    "slug": "jubran",
    "name": "مطعم جبران",
    "owner": "jubran.owner",
    "branches": [
      {
        "slug": "jubran-mocambo",
        "name": "الموكامبو",
        "floors": [
          [
            "الأرضي",
            [
              [
                "الصالة الداخلية",
                20
              ],
              [
                "الجلسات الخارجية",
                10
              ]
            ]
          ],
          [
            "الأول",
            [
              [
                "صالة العائلات",
                12
              ],
              [
                "التراس",
                8
              ]
            ]
          ]
        ],
        "employees": [
          [
            "jubran.waiter.1",
            "غارسون 1",
            "waiter"
          ],
          [
            "jubran.waiter.2",
            "غارسون 2",
            "waiter"
          ],
          [
            "jubran.waiter.3",
            "غارسون 3",
            "waiter"
          ],
          [
            "jubran.waiter.4",
            "غارسون 4",
            "waiter"
          ],
          [
            "jubran.waiter.5",
            "غارسون 5",
            "waiter"
          ],
          [
            "jubran.waiter.6",
            "غارسون 6",
            "waiter"
          ],
          [
            "jubran.waiter.7",
            "غارسون 7",
            "waiter"
          ],
          [
            "jubran.waiter.8",
            "غارسون 8",
            "waiter"
          ],
          [
            "jubran.hookah.1",
            "موظف أراكيل 1",
            "hookah"
          ],
          [
            "jubran.hookah.2",
            "موظف أراكيل 2",
            "hookah"
          ],
          [
            "jubran.hookah.3",
            "موظف أراكيل 3",
            "hookah"
          ],
          [
            "jubran.hookah.4",
            "موظف أراكيل 4",
            "hookah"
          ]
        ]
      }
    ]
  }
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
    "INSERT INTO restaurants(name,slug,is_active,subdomain,domain_status,logo_url,primary_color,secondary_color,font_family) VALUES($1,$2,true,$2,'pending',$3,'#D4AF37','#111111','cairo') RETURNING id",
    [restaurant.name,restaurant.slug,logoUrl])).id;
}
async function ensureBranch(client, restaurantId, slug, name) {
  const row = await single(client, "SELECT id,restaurant_id FROM branches WHERE slug=$1 FOR UPDATE", [slug]);
  if (row) {
    if (row.restaurant_id !== restaurantId) throw new Error("Branch belongs to another restaurant: " + slug);
    return row.id;
  }
  summary.branches++;
  return (await single(client,
    "INSERT INTO branches(restaurant_id,name,slug,currency,is_active) VALUES($1,$2,$3,'SYP',true) RETURNING id",
    [restaurantId,name,slug])).id;
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
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("TRUNCATE TABLE audit_logs, auth_sessions, auth_login_attempts, auth_refresh_history, subscription_terms, renewal_contacts, categories, products, product_images, floors, areas, restaurant_tables, qr_credentials, restaurant_call_settings, branch_call_settings, employee_shifts, visit_sessions, service_calls, call_outbox, owner_alerts, employee_push_devices, push_deliveries, restaurant_event_counters, realtime_events, media_assets, subscriptions, users, plans, branches, restaurants");
    const existingAdmins = await client.query("SELECT username FROM users WHERE role='PRIMARY_ADMIN'");
    if (existingAdmins.rows.some(x => x.username !== "platform.admin"))
      throw new Error("Another primary administrator exists; refusing a competing admin.");
    const adminId = await ensureUser(client,"platform.admin","مسؤول المنصة","PRIMARY_ADMIN");
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
      await ensureUser(client,restaurant.owner,"مالك مطعم جبران - تجريبي","RESTAURANT_OWNER",restaurantId);
      await ensureSubscription(client,restaurantId,plan.id,adminId);
      for (const branch of restaurant.branches) {
      const branchId = await ensureBranch(client,restaurantId,branch.slug,branch.name);
      for (const [username,displayName,department] of branch.employees) {
        await ensureUser(client,username,displayName,"EMPLOYEE",restaurantId,branchId,department);
      }
      await client.query(`INSERT INTO restaurant_call_settings
        (restaurant_id,enabled,waiter_enabled,hookah_enabled,routing_mode)
        VALUES($1,true,true,true,'department_on_shift') ON CONFLICT(restaurant_id) DO NOTHING`,[restaurantId]);
      await client.query(`INSERT INTO branch_call_settings
        (branch_id,enabled,waiter_enabled,hookah_enabled,routing_mode)
        VALUES($1,true,true,true,'department_on_shift') ON CONFLICT(branch_id) DO NOTHING`,[branchId]);
      let n=0;
      for (const [floorName,areas] of branch.floors) {
        const floorId=await ensureByName(client,"floors","branch_id",branchId,floorName,["restaurant_id","sort_order"],[restaurantId,n]);
        for(const [areaName,count] of areas) {
          const areaId=await ensureByName(client,"areas","floor_id",floorId,areaName,["restaurant_id","branch_id","sort_order"],[restaurantId,branchId,n]);
          for(let i=0;i<count;i++){n++;await ensureTable(client,restaurantId,branchId,areaId,String(n),n);}
        }
      }
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
             sort_order,is_visible,is_sold_out,old_price_minor,tags)
            VALUES($1,$2,$3,$4,$5,$6,'SYP',$7,$8,$9,$10,$11)`,
            [restaurantId,branchId,categoryId,name,description,price*100,productOrder++,name!=="فاهيتا",name==="ريش غنم",name==="مشاوي مشكلة"?15000000:null,[]]);
          summary.products++;
        }
      }
    }
    }
    if(summary.tables!==50 || summary.qrCredentials!==50 || summary.products!==80 || summary.users!==14 || summary.categories!==12 || summary.branches!==1 || summary.floors!==2 || summary.areas!==4) throw new Error("Unexpected seed counts");
    await client.query(dryRun ? "ROLLBACK" : "COMMIT");
    transaction=false;
    console.log(dryRun ? "DRY RUN successful: all changes rolled back." : "Replacement seed committed.");
    console.table(summary);
    if (generated.length && !dryRun) {
      console.log("ONE-TIME CREDENTIALS - store privately now; never post or commit:");
      console.table(generated);
      console.log("All old database accounts were replaced. Domain remains pending until manual routing is verified.");
    } else if (!dryRun) {
      console.log("All accounts already exist; passwords unchanged. For intentional demo-account rotation, use --reset-demo-passwords with separate confirmation.");
    }
  } catch(error) {
    if(transaction) await client.query("ROLLBACK").catch(()=>{});
    throw error;
  } finally { await client.end().catch(()=>{}); }
}
run().catch(error => { console.error(error instanceof Error?error.message:"Seed failed");process.exitCode=1; });
