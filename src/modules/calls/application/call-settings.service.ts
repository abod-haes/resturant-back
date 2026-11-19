import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthPrincipal } from "../../../common/auth/principal";
import { requireOperationalEntitlements } from "../../../common/subscription/operational-entitlement";
import { effectiveCallSettings, type EffectiveCallSettings } from "../../../common/calls/call-settings";
import { DatabaseService } from "../../../database/database.service";
import type { BranchCallSettingsDto, RestaurantCallSettingsDto } from "../presentation/calls.dto";

@Injectable()
export class CallSettingsService {
  constructor(private readonly database: DatabaseService) {}
  private tenant(principal: AuthPrincipal): string {
    if (!principal.restaurantId) throw new ForbiddenException("Restaurant owner required");
    return principal.restaurantId;
  }
  private async requireBranch(restaurantId: string, branchId: string) {
    const branch = await this.database.db.selectFrom("branches").select("id")
      .where("id", "=", branchId).where("restaurant_id", "=", restaurantId).executeTakeFirst();
    if (!branch) throw new NotFoundException("Branch not found");
  }
  async get(restaurantId: string, branchId: string): Promise<EffectiveCallSettings> {
    return effectiveCallSettings(this.database.db, restaurantId, branchId);
  }
  async ownerRoot(principal: AuthPrincipal): Promise<EffectiveCallSettings> {
    const restaurantId = this.tenant(principal);
    await requireOperationalEntitlements(this.database.db, restaurantId);
    const root = await this.database.db.selectFrom("restaurant_call_settings")
      .selectAll().where("restaurant_id", "=", restaurantId).executeTakeFirst();
    return {
      enabled: root?.enabled ?? true, waiterEnabled: root?.waiter_enabled ?? true,
      hookahEnabled: root?.hookah_enabled ?? false, routingMode: root?.routing_mode ?? "all_on_shift",
      shiftAutoEndMinutes: root?.shift_auto_end_minutes ?? 720,
    };
  }
  async ownerBranch(principal: AuthPrincipal, branchId: string) {
    const restaurantId = this.tenant(principal);
    await this.requireBranch(restaurantId, branchId);
    await requireOperationalEntitlements(this.database.db, restaurantId);
    return this.get(restaurantId, branchId);
  }
  async updateRoot(principal: AuthPrincipal, body: RestaurantCallSettingsDto, requestId?: string) {
    const restaurantId = this.tenant(principal);
    if (!Object.keys(body).length) throw new BadRequestException("At least one setting required");
    await this.database.db.transaction().execute(async trx => {
      const root = await trx.selectFrom("restaurants").select("id")
        .where("id", "=", restaurantId).forUpdate().executeTakeFirst();
      if (!root) throw new NotFoundException("Restaurant not found");
      await requireOperationalEntitlements(trx, restaurantId);
      const patch: { enabled?: boolean; waiter_enabled?: boolean; hookah_enabled?: boolean;
        routing_mode?: "all_on_shift" | "department_on_shift"; shift_auto_end_minutes?: number } = {};
      if (body.enabled !== undefined) patch.enabled = body.enabled;
      if (body.waiterEnabled !== undefined) patch.waiter_enabled = body.waiterEnabled;
      if (body.hookahEnabled !== undefined) patch.hookah_enabled = body.hookahEnabled;
      if (body.routingMode !== undefined) patch.routing_mode = body.routingMode;
      if (body.shiftAutoEndMinutes !== undefined) patch.shift_auto_end_minutes = body.shiftAutoEndMinutes;
      await trx.insertInto("restaurant_call_settings").values({ restaurant_id: restaurantId, ...patch })
        .onConflict(oc => oc.column("restaurant_id").doUpdateSet(patch)).execute();
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: restaurantId,
        action: "call_settings.restaurant.updated", entity_type: "restaurant", entity_id: restaurantId,
        request_id: requestId ?? null, metadata: { fields: Object.keys(patch).sort() },
      }).execute();
    });
    return this.ownerRoot(principal);
  }
  async updateBranch(principal: AuthPrincipal, branchId: string,
    body: BranchCallSettingsDto, requestId?: string) {
    const restaurantId = this.tenant(principal);
    if (!Object.keys(body).length) throw new BadRequestException("At least one setting required");
    await this.database.db.transaction().execute(async trx => {
      const restaurant = await trx.selectFrom("restaurants").select("id")
        .where("id", "=", restaurantId).forUpdate().executeTakeFirst();
      if (!restaurant) throw new NotFoundException("Restaurant not found");
      await requireOperationalEntitlements(trx, restaurantId);
      const branch = await trx.selectFrom("branches").select("id")
        .where("id", "=", branchId).where("restaurant_id", "=", restaurantId).executeTakeFirst();
      if (!branch) throw new NotFoundException("Branch not found");
      const patch: { enabled?: boolean | null; waiter_enabled?: boolean | null;
        hookah_enabled?: boolean | null; routing_mode?: "all_on_shift" | "department_on_shift" | null } = {};
      if (body.enabled !== undefined) patch.enabled = body.enabled;
      if (body.waiterEnabled !== undefined) patch.waiter_enabled = body.waiterEnabled;
      if (body.hookahEnabled !== undefined) patch.hookah_enabled = body.hookahEnabled;
      if (body.routingMode !== undefined) patch.routing_mode = body.routingMode;
      await trx.insertInto("branch_call_settings").values({
        branch_id: branchId, enabled: patch.enabled ?? null,
        waiter_enabled: patch.waiter_enabled ?? null, hookah_enabled: patch.hookah_enabled ?? null,
        routing_mode: patch.routing_mode ?? null,
      }).onConflict(oc => oc.column("branch_id").doUpdateSet(patch)).execute();
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: restaurantId,
        action: "call_settings.branch.updated", entity_type: "branch", entity_id: branchId,
        request_id: requestId ?? null, metadata: { fields: Object.keys(patch).sort() },
      }).execute();
    });
    return this.ownerBranch(principal, branchId);
  }
}
