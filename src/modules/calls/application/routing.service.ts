import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Kysely, Transaction } from "kysely";
import type { AuthPrincipal } from "../../../common/auth/principal";
import { requireOperationalEntitlements } from "../../../common/subscription/operational-entitlement";
import { DatabaseService } from "../../../database/database.service";
import type { CallRoutingMode, DatabaseTables } from "../../../database/database.types";
import type { BranchRoutingPatchDto } from "../presentation/calls.dto";

type Client = Kysely<DatabaseTables> | Transaction<DatabaseTables>;

export async function effectiveRouting(db: Client, restaurantId: string, branchId: string): Promise<CallRoutingMode> {
  const branch = await db.selectFrom("branch_call_settings").select("routing_mode")
    .where("branch_id", "=", branchId).executeTakeFirst();
  if (branch?.routing_mode) return branch.routing_mode;
  const restaurant = await db.selectFrom("restaurant_call_settings").select("routing_mode")
    .where("restaurant_id", "=", restaurantId).executeTakeFirst();
  return restaurant?.routing_mode ?? "department";
}

@Injectable()
export class RoutingService {
  constructor(private readonly database: DatabaseService) {}

  private restaurant(principal: AuthPrincipal): string {
    if (!principal.restaurantId) throw new ForbiddenException("Restaurant scope required");
    return principal.restaurantId;
  }

  private async branch(principal: AuthPrincipal, branchId: string): Promise<void> {
    const restaurantId = this.restaurant(principal);
    await requireOperationalEntitlements(this.database.db, restaurantId);
    const row = await this.database.db.selectFrom("branches").select("id")
      .where("id", "=", branchId).where("restaurant_id", "=", restaurantId)
      .where("is_active", "=", true).executeTakeFirst();
    if (!row) throw new NotFoundException("Branch not found");
  }

  async getRestaurant(principal: AuthPrincipal) {
    const restaurantId = this.restaurant(principal);
    await requireOperationalEntitlements(this.database.db, restaurantId);
    const settings = await this.database.db.selectFrom("restaurant_call_settings")
      .select("routing_mode").where("restaurant_id", "=", restaurantId).executeTakeFirst();
    return { routingMode: settings?.routing_mode ?? "department" };
  }

  async updateRestaurant(principal: AuthPrincipal, mode: CallRoutingMode, requestId?: string) {
    const restaurantId = this.restaurant(principal);
    return this.database.db.transaction().execute(async (trx) => {
      await trx.selectFrom("restaurants").select("id")
        .where("id", "=", restaurantId).forUpdate().executeTakeFirstOrThrow();
      await requireOperationalEntitlements(trx, restaurantId);
      await trx.insertInto("restaurant_call_settings")
        .values({ restaurant_id: restaurantId, routing_mode: mode })
        .onConflict((oc) => oc.column("restaurant_id").doUpdateSet({ routing_mode: mode })).execute();
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: restaurantId, action: "routing.restaurant.updated",
        entity_type: "restaurant", entity_id: restaurantId, metadata: { routingMode: mode },
        request_id: requestId ?? null,
      }).execute();
      return { routingMode: mode };
    });
  }

  async getBranch(principal: AuthPrincipal, branchId: string) {
    await this.branch(principal, branchId);
    const row = await this.database.db.selectFrom("branch_call_settings")
      .select(["routing_mode","shift_max_minutes"]).where("branch_id", "=", branchId).executeTakeFirst();
    const routingMode = row?.routing_mode ?? null;
    return { routingMode, shiftMaxMinutes: row?.shift_max_minutes ?? 720,
      effectiveRoutingMode: await effectiveRouting(this.database.db, this.restaurant(principal), branchId) };
  }

  async updateBranch(principal: AuthPrincipal, branchId: string, patch: BranchRoutingPatchDto, requestId?: string) {
    if (!Object.keys(patch).length) throw new BadRequestException("At least one routing field required");
    await this.branch(principal, branchId);
    await this.database.db.transaction().execute(async (trx) => {
      await trx.selectFrom("restaurants").select("id")
        .where("id", "=", this.restaurant(principal)).forUpdate().executeTakeFirstOrThrow();
      await requireOperationalEntitlements(trx, this.restaurant(principal));
      const previous = await trx.selectFrom("branch_call_settings").selectAll()
        .where("branch_id", "=", branchId).executeTakeFirst();
      await trx.insertInto("branch_call_settings").values({
        branch_id: branchId, routing_mode: patch.routingMode === undefined ? previous?.routing_mode ?? null : patch.routingMode,
        shift_max_minutes: patch.shiftMaxMinutes ?? previous?.shift_max_minutes ?? 720,
      }).onConflict((oc) => oc.column("branch_id").doUpdateSet({
        routing_mode: patch.routingMode === undefined ? previous?.routing_mode ?? null : patch.routingMode,
        shift_max_minutes: patch.shiftMaxMinutes ?? previous?.shift_max_minutes ?? 720,
      })).execute();
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: this.restaurant(principal),
        action: "routing.branch.updated", entity_type: "branch", entity_id: branchId,
        request_id: requestId ?? null, metadata: { fields: Object.keys(patch).sort() },
      }).execute();
    });
    return this.getBranch(principal, branchId);
  }
}
