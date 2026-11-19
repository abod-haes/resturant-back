import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Kysely, Transaction } from "kysely";
import type { AuthPrincipal } from "../../../common/auth/principal";
import { requireOperationalEntitlements } from "../../../common/subscription/operational-entitlement";
import type { DatabaseTables } from "../../../database/database.types";

export type MediaDatabase = Kysely<DatabaseTables> | Transaction<DatabaseTables>;
export function ownerTenant(principal: AuthPrincipal): string {
  if (principal.role !== "RESTAURANT_OWNER" || !principal.restaurantId) throw new ForbiddenException("Owner scope required");
  return principal.restaurantId;
}
export async function requireMediaBranch(db: MediaDatabase, principal: AuthPrincipal, branchId: string) {
  const restaurantId = ownerTenant(principal);
  const row = await db.selectFrom("branches").select(["id","restaurant_id"])
    .where("id", "=", branchId).where("restaurant_id", "=", restaurantId)
    .where("is_active", "=", true).executeTakeFirst();
  if (!row) throw new NotFoundException("Branch not found");
  await requireOperationalEntitlements(db, restaurantId, "menu");
  return row;
}
export async function lockMediaTenant(db: MediaDatabase, principal: AuthPrincipal) {
  const restaurantId = ownerTenant(principal);
  const row = await db.selectFrom("restaurants").select("id")
    .where("id", "=", restaurantId).forUpdate().executeTakeFirst();
  if (!row) throw new NotFoundException("Restaurant not found");
  return restaurantId;
}
