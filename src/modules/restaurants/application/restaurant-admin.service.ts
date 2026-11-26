import { RUNTIME_CONFIG, type RuntimeConfig } from "../../../common/config/runtime-config";
import { managedImagePath } from "../../../common/tenancy/managed-image-path";
import {
  BadRequestException, ConflictException, Inject, Injectable, NotFoundException,
} from "@nestjs/common";
import { isAssignableSubdomain } from "../../../common/tenancy/subdomain";
import { randomUUID } from "node:crypto";
import { POSTGRES_UUID_PATTERN } from "../../../common/http/parse-postgres-uuid.pipe";
import { sql } from "kysely";
import { DatabaseService } from "../../../database/database.service";
import { hashPassword } from "../../../common/crypto/password";
import type { AuthPrincipal } from "../../../common/auth/principal";
import type {
  CreateRestaurantDto, RestaurantListQueryDto, UpdateRestaurantDto,
  RestaurantDetailsDto, RestaurantSummaryDto,
} from "../presentation/restaurant-admin.dto";

interface ListPage {
  data: RestaurantSummaryDto[];
  meta: { nextCursor: string | null; hasMore: boolean };
}

interface CursorValue {
  timestamp: string;
  id: string;
}

function parseCursor(cursor: string): CursorValue {
  try {
    if (!/^[A-Za-z0-9_-]{1,500}$/.test(cursor)) throw new Error("Bad encoding");
    const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) throw new Error("Bad cursor");
    if (!("timestamp" in decoded) || !("id" in decoded)) throw new Error("Missing cursor fields");
    const timestamp = decoded.timestamp;
    const id = decoded.id;
    if (typeof timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(timestamp) ||
      !Number.isFinite(Date.parse(timestamp)) || typeof id !== "string" || !POSTGRES_UUID_PATTERN.test(id)) {
      throw new Error("Bad cursor values");
    }
    return { timestamp, id };
  } catch {
    throw new BadRequestException("Invalid pagination cursor");
  }
}

function isUsernameConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return "code" in error && error.code === "23505" &&
    "constraint" in error && error.constraint === "users_username_ci_unique";
}

function validateSubdomain(value: string): void {
  if (!isAssignableSubdomain(value)) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "Invalid or reserved subdomain" });
}
function rethrowDomainConflict(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "23505" && "constraint" in error && error.constraint === "restaurants_subdomain_unique") {
    throw new ConflictException({ code: "SUBDOMAIN_TAKEN", message: "Subdomain is already in use" });
  }
  throw error;
}

type RestaurantRow = {
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  font_family: "cairo" | "system" | null;
  subdomain: string | null;
  domain_status: "pending" | "ready";
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: Date;
  owner_id: string | null;
  owner_name: string | null;
  owner_username: string | null;
  branch_count: number;
  subscription_status: string | null;
  plan_name: string | null;
};

function toSummary(row: RestaurantRow, publicOrigin?: string): RestaurantSummaryDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    subdomain: row.subdomain,
    domainStatus: row.domain_status,
    branding: { logoUrl: row.logo_url, logoPath: managedImagePath(row.logo_url, row.id, publicOrigin), primaryColor: row.primary_color, secondaryColor: row.secondary_color, fontFamily: row.font_family },
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    branchCount: row.branch_count,
    subscriptionStatus: row.subscription_status,
    planName: row.plan_name,
    owner: row.owner_id && row.owner_name && row.owner_username
      ? { id: row.owner_id, name: row.owner_name, username: row.owner_username }
      : null,
  };
}

@Injectable()
export class RestaurantAdminService {
  constructor(private readonly database: DatabaseService, @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  private selection() {
    return this.database.db.selectFrom("restaurants")
      .leftJoin("users", (join) => join
        .onRef("users.restaurant_id", "=", "restaurants.id")
        .on("users.role", "=", "RESTAURANT_OWNER"))
      .select([
        "restaurants.id", "restaurants.name", "restaurants.slug",
        "restaurants.is_active", "restaurants.created_at", "restaurants.subdomain", "restaurants.domain_status", "restaurants.logo_url", "restaurants.primary_color", "restaurants.secondary_color", "restaurants.font_family",
        "users.id as owner_id", "users.display_name as owner_name",
        "users.username as owner_username",
        sql<number>`(select count(*)::int from branches b where b.restaurant_id = restaurants.id and b.is_active)`.as("branch_count"),
        sql<string | null>`(select s.status from subscriptions s where s.restaurant_id = restaurants.id order by (s.status = 'active') desc, s.created_at desc limit 1)`.as("subscription_status"),
        sql<string | null>`(select p.name from subscriptions s join plans p on p.id = s.plan_id where s.restaurant_id = restaurants.id order by (s.status = 'active') desc, s.created_at desc limit 1)`.as("plan_name"),
      ]);
  }

  async create(payload: CreateRestaurantDto, actor: AuthPrincipal, requestId: string | undefined) {
    if (payload.subdomain != null) validateSubdomain(payload.subdomain);
    const passwordHash = await hashPassword(payload.owner.initialPassword);
    const id = randomUUID();
    const ownerId = randomUUID();
    const branchId = randomUUID();
    // Slugs are stable, opaque unique identifiers; names can contain arbitrary Unicode.
    const slug = "r-" + id.replaceAll("-", "");
    const branchSlug = "b-" + branchId.replaceAll("-", "");
    try {
      return await this.database.db.transaction().execute(async (trx) => {
        await trx.insertInto("restaurants").values({
          id, name: payload.name.trim(), slug, is_active: true, subdomain: payload.subdomain ?? null,
        }).execute();
        await trx.insertInto("branches").values({
          id: branchId, restaurant_id: id, name: payload.initialBranch.name.trim(),
          slug: branchSlug, currency: null, is_active: true,
        }).execute();
        await trx.insertInto("users").values({
          id: ownerId, username: payload.owner.username, display_name: payload.owner.name.trim(),
          password_hash: passwordHash, role: "RESTAURANT_OWNER", restaurant_id: id,
          branch_id: null, department: null, must_change_password: true, is_active: true,
        }).execute();
        await trx.insertInto("audit_logs").values({
          actor_user_id: actor.id, restaurant_id: id,
          action: "restaurant.created", entity_type: "restaurant", entity_id: id,
          request_id: requestId ?? null, metadata: { ownerId, branchId },
        }).execute();
        return { id, name: payload.name.trim(), ownerId, branchId, subdomain: payload.subdomain ?? null, domainStatus: "pending" as const };
      });
    } catch (error: unknown) {
      if (isUsernameConflict(error)) {
        throw new ConflictException({ code: "OWNER_USERNAME_TAKEN", message: "Owner username is already in use" });
      }
      rethrowDomainConflict(error);
    }
  }

  async list(query: RestaurantListQueryDto): Promise<ListPage> {
    const limit = query.limit;
    let select = this.selection()
      .select(sql<string>`to_char(restaurants.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("cursor_timestamp"));
    if (query.status) select = select.where("restaurants.is_active", "=", query.status === "active");
    if (query.planId) {
      select = select.where(sql<boolean>`(
        SELECT s.plan_id FROM subscriptions s WHERE s.restaurant_id = restaurants.id
        ORDER BY (s.status = 'active') DESC, s.created_at DESC LIMIT 1
      ) = ${query.planId}::uuid`);
    }
    if (query.search) {
      // Parameters are bound; percent and underscore are treated as literal search characters.
      select = select.where(sql<boolean>`position(lower(${query.search}) in lower(${sql.ref("restaurants.name")})) > 0`);
    }
    if (query.cursor) {
      const cursor = parseCursor(query.cursor);
      select = select.where(sql<boolean>`(restaurants.created_at, restaurants.id) < (${cursor.timestamp}::timestamptz, ${cursor.id}::uuid)`);
    }
    const rows = await select
      .orderBy("restaurants.created_at", "desc")
      .orderBy("restaurants.id", "desc")
      .limit(limit + 1)
      .execute();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = hasMore && last
      ? Buffer.from(JSON.stringify({ timestamp: last.cursor_timestamp, id: last.id })).toString("base64url")
      : null;
    return { data: page.map(row => toSummary(row, this.config.mediaStorage?.publicOrigin)), meta: { nextCursor, hasMore } };
  }

  async get(id: string): Promise<RestaurantDetailsDto> {
    const restaurant = await this.selection().where("restaurants.id", "=", id).executeTakeFirst();
    if (!restaurant) throw new NotFoundException("Restaurant not found");
    const initialBranch = await this.database.db.selectFrom("branches")
      .select(["id", "name", "slug", "is_active"])
      .where("restaurant_id", "=", id)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .executeTakeFirst();
    return { ...toSummary(restaurant, this.config.mediaStorage?.publicOrigin), initialBranch: initialBranch
      ? { id: initialBranch.id, name: initialBranch.name,
          slug: initialBranch.slug, isActive: initialBranch.is_active } : null };
  }

  async update(id: string, changes: UpdateRestaurantDto, actor: AuthPrincipal, requestId: string | undefined): Promise<RestaurantDetailsDto> {
    const patch: { name?: string; is_active?: boolean; subdomain?: string; domain_status?: "pending" | "ready"; logo_url?: string | null; primary_color?: string | null; secondary_color?: string | null; font_family?: "cairo" | "system" | null } = {};
    if (changes.name !== undefined) patch.name = changes.name.trim();
    if (changes.isActive !== undefined) patch.is_active = changes.isActive;
    if (changes.subdomain != null) { validateSubdomain(changes.subdomain); patch.subdomain = changes.subdomain; }
    if (changes.domainStatus != null) patch.domain_status = changes.domainStatus;
    if (changes.branding?.logoUrl !== undefined) patch.logo_url = changes.branding.logoUrl;
    if (changes.branding?.primaryColor !== undefined) patch.primary_color = changes.branding.primaryColor;
    if (changes.branding?.secondaryColor !== undefined) patch.secondary_color = changes.branding.secondaryColor;
    if (changes.branding?.fontFamily !== undefined) patch.font_family = changes.branding.fontFamily;
    if (Object.keys(patch).length === 0) throw new BadRequestException("At least one field is required");

    try { await this.database.db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom("restaurants").select(["subdomain", "domain_status"]).where("id", "=", id).forUpdate().executeTakeFirst();
      if (!current) throw new NotFoundException("Restaurant not found");
      if (current.subdomain && patch.subdomain && current.subdomain !== patch.subdomain) throw new ConflictException({ code: "SUBDOMAIN_IMMUTABLE", message: "Subdomain cannot be changed" });
      if ((patch.domain_status ?? current.domain_status) === "ready" && !(patch.subdomain ?? current.subdomain)) throw new BadRequestException("Subdomain required before marking ready");
      if (patch.logo_url) {
        const managed = await trx.selectFrom("media_assets").select(["restaurant_id", "kind", "status"]).where("public_url", "=", patch.logo_url).executeTakeFirst();
        if (managed && (managed.restaurant_id !== id || managed.kind !== "image" || managed.status !== "ready")) throw new BadRequestException("Invalid restaurant logo asset");
        if (this.config.mediaStorage && patch.logo_url.startsWith(this.config.mediaStorage.publicOrigin + "/r/") && !managed) throw new BadRequestException("Invalid restaurant logo asset");
      }
      const updated = await trx.updateTable("restaurants")
        .set(patch)
        .where("id", "=", id)
        .returning("id").executeTakeFirst();
      if (!updated) throw new NotFoundException("Restaurant not found");
      await trx.insertInto("audit_logs").values({
        actor_user_id: actor.id, restaurant_id: id,
        action: "restaurant.updated", entity_type: "restaurant", entity_id: id,
        request_id: requestId ?? null,
        metadata: { fields: Object.keys(patch).sort() },
      }).execute();
    }); } catch (error: unknown) { rethrowDomainConflict(error); }
    return this.get(id);
  }
}
