import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { DatabaseService } from "../../../database/database.service";
import type { AuthPrincipal } from "../../../common/auth/principal";
import { decodeKeysetCursor, encodeKeysetCursor } from "../../../common/pagination/keyset";
import { requireOperationalEntitlements } from "../../../common/subscription/operational-entitlement";
import type { BranchCreateDto, BranchDto, BranchPageDto, BranchPatchDto } from "../presentation/branch.dto";

function tenantId(principal: AuthPrincipal): string {
  if (!principal.restaurantId) throw new ForbiddenException("Restaurant scope required");
  return principal.restaurantId;
}

type BranchRow = {
  id: string; name: string; slug: string; currency: string | null;
  is_active: boolean; created_at: Date;
};
function serialize(row: BranchRow): BranchDto {
  return { id: row.id, name: row.name, slug: row.slug, currency: row.currency,
    isActive: row.is_active, createdAt: row.created_at.toISOString() };
}

@Injectable()
export class BranchesService {
  constructor(private readonly database: DatabaseService) {}

  async list(principal: AuthPrincipal, query: BranchPageDto) {
    const restaurantId = tenantId(principal);
    await requireOperationalEntitlements(this.database.db, restaurantId);
    let select = this.database.db.selectFrom("branches")
      .select(["id", "name", "slug", "currency", "is_active", "created_at"])
      .select(sql<string>`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("cursor_timestamp"))
      .where("restaurant_id", "=", restaurantId);
    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor);
      select = select.where(sql<boolean>`(created_at,id) < (${cursor.timestamp}::timestamptz,${cursor.id}::uuid)`);
    }
    const result = await select.orderBy("created_at", "desc").orderBy("id", "desc")
      .limit(query.limit + 1).execute();
    const hasMore = result.length > query.limit;
    const rows = result.slice(0, query.limit);
    const last = rows.at(-1);
    return { data: rows.map(serialize), meta: { hasMore, nextCursor: hasMore && last
      ? encodeKeysetCursor({ timestamp: last.cursor_timestamp, id: last.id }) : null } };
  }

  async get(principal: AuthPrincipal, branchId: string): Promise<BranchDto> {
    const restaurantId = tenantId(principal);
    await requireOperationalEntitlements(this.database.db, restaurantId);
    const branch = await this.database.db.selectFrom("branches")
      .select(["id", "name", "slug", "currency", "is_active", "created_at"])
      .where("id", "=", branchId).where("restaurant_id", "=", restaurantId).executeTakeFirst();
    if (!branch) throw new NotFoundException("Branch not found");
    return serialize(branch);
  }

  async create(principal: AuthPrincipal, body: BranchCreateDto, requestId?: string): Promise<BranchDto> {
    const restaurantId = tenantId(principal);
    return this.database.db.transaction().execute(async (trx) => {
      const restaurant = await trx.selectFrom("restaurants").select("id")
        .where("id", "=", restaurantId).forUpdate().executeTakeFirst();
      if (!restaurant) throw new NotFoundException("Restaurant not found");
      const entitlements = await requireOperationalEntitlements(trx, restaurantId);
      const count = await trx.selectFrom("branches")
        .select(sql<number>`count(*)::int`.as("total"))
        .where("restaurant_id", "=", restaurantId).executeTakeFirstOrThrow();
      // Count every branch, including disabled ones, so limits cannot be bypassed by toggling visibility.
      if (count.total >= entitlements.maxBranches) {
        throw new ForbiddenException({ code: "PLAN_LIMIT_REACHED", message: "Maximum branches for plan reached" });
      }
      const id = randomUUID();
      const branch = await trx.insertInto("branches").values({
        id, restaurant_id: restaurantId, name: body.name.trim(),
        slug: "b-" + id.replaceAll("-", ""), currency: body.currency ?? null,
        is_active: true,
      }).returning(["id", "name", "slug", "currency", "is_active", "created_at"]).executeTakeFirstOrThrow();
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: restaurantId,
        action: "branch.created", entity_type: "branch", entity_id: branch.id,
        request_id: requestId ?? null, metadata: {},
      }).execute();
      return serialize(branch);
    });
  }

  async patch(principal: AuthPrincipal, branchId: string, body: BranchPatchDto,
    requestId?: string): Promise<BranchDto> {
    if (!Object.keys(body).length) throw new BadRequestException("At least one field required");
    const restaurantId = tenantId(principal);
    return this.database.db.transaction().execute(async (trx) => {
      // Lock the same restaurant row as branch creation and menu copy to serialize quota/currency changes.
      const restaurant = await trx.selectFrom("restaurants").select("id")
        .where("id", "=", restaurantId).forUpdate().executeTakeFirst();
      if (!restaurant) throw new NotFoundException("Restaurant not found");
      await requireOperationalEntitlements(trx, restaurantId);
      const existing = await trx.selectFrom("branches").selectAll()
        .where("id", "=", branchId).where("restaurant_id", "=", restaurantId)
        .forUpdate().executeTakeFirst();
      if (!existing) throw new NotFoundException("Branch not found");
      if (body.currency && existing.currency && body.currency !== existing.currency) {
        const priced = await trx.selectFrom("products").select("id")
          .where("branch_id", "=", branchId).limit(1).executeTakeFirst();
        if (priced) throw new ConflictException({ code: "BRANCH_CURRENCY_IN_USE",
          message: "Branch currency cannot change while priced products exist" });
      }
      const patch: { name?: string; currency?: string; is_active?: boolean } = {};
      if (body.name !== undefined) patch.name = body.name.trim();
      if (body.currency !== undefined) patch.currency = body.currency;
      if (body.isActive !== undefined) patch.is_active = body.isActive;
      const row = await trx.updateTable("branches").set(patch)
        .where("id", "=", branchId)
        .returning(["id", "name", "slug", "currency", "is_active", "created_at"]).executeTakeFirstOrThrow();
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: restaurantId,
        action: "branch.updated", entity_type: "branch", entity_id: branchId,
        request_id: requestId ?? null, metadata: { fields: Object.keys(patch).sort() },
      }).execute();
      return serialize(row);
    });
  }
}
