import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Kysely, Transaction } from "kysely";
import type { AuthPrincipal } from "../../../common/auth/principal";
import { requireOperationalEntitlements } from "../../../common/subscription/operational-entitlement";
import type { DatabaseTables } from "../../../database/database.types";

export type MenuClient = Kysely<DatabaseTables> | Transaction<DatabaseTables>;

export async function requireOwnerBranch(client: MenuClient, principal: AuthPrincipal, branchId: string) {
  if (!principal.restaurantId) throw new ForbiddenException("Restaurant scope required");
  const branch = await client.selectFrom("branches")
    .select(["id", "restaurant_id", "name", "slug", "currency", "is_active"])
    .where("id", "=", branchId).where("restaurant_id", "=", principal.restaurantId)
    .executeTakeFirst();
  if (!branch || !branch.is_active) throw new NotFoundException("Branch not found");
  await requireOperationalEntitlements(client, principal.restaurantId, "menu");
  return branch;
}

export async function lockTenantForMenuWrite(client: MenuClient, principal: AuthPrincipal): Promise<void> {
  if (!principal.restaurantId) throw new ForbiddenException("Restaurant scope required");
  const restaurant = await client.selectFrom("restaurants").select("id")
    .where("id", "=", principal.restaurantId).forUpdate().executeTakeFirst();
  if (!restaurant) throw new NotFoundException("Restaurant not found");
}
