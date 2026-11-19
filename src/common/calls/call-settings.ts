import type { Kysely, Transaction } from "kysely";
import type { DatabaseTables, CallRoutingMode, CallType, EntitlementSnapshot } from "../../database/database.types";
type Client = Kysely<DatabaseTables> | Transaction<DatabaseTables>;
export interface EffectiveCallSettings {
  enabled: boolean;
  waiterEnabled: boolean;
  hookahEnabled: boolean;
  routingMode: CallRoutingMode;
  shiftAutoEndMinutes: number;
}
export async function effectiveCallSettings(db: Client, restaurantId: string, branchId: string): Promise<EffectiveCallSettings> {
  const [root, override] = await Promise.all([
    db.selectFrom("restaurant_call_settings").selectAll().where("restaurant_id", "=", restaurantId).executeTakeFirst(),
    db.selectFrom("branch_call_settings").selectAll().where("branch_id", "=", branchId).executeTakeFirst(),
  ]);
  return {
    enabled: override?.enabled ?? root?.enabled ?? true,
    waiterEnabled: override?.waiter_enabled ?? root?.waiter_enabled ?? true,
    hookahEnabled: override?.hookah_enabled ?? root?.hookah_enabled ?? false,
    routingMode: override?.routing_mode ?? root?.routing_mode ?? "all_on_shift",
    shiftAutoEndMinutes: root?.shift_auto_end_minutes ?? 720,
  };
}
export function callIsAvailable(
  type: CallType, callsEnabled: boolean, settings: EffectiveCallSettings, entitlements: EntitlementSnapshot,
): boolean {
  return callsEnabled && settings.enabled
    && (type === "waiter" ? settings.waiterEnabled && entitlements.features.waiter_calls :
      settings.hookahEnabled && entitlements.features.hookah_calls);
}
