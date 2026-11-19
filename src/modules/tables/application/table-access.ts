import { ForbiddenException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { Kysely, Transaction } from "kysely";
import type { AuthPrincipal } from "../../../common/auth/principal";
import type { DatabaseTables } from "../../../database/database.types";
import { requireOperationalEntitlements } from "../../../common/subscription/operational-entitlement";
import type { RuntimeConfig } from "../../../common/config/runtime-config";

export type TablesDb = Kysely<DatabaseTables> | Transaction<DatabaseTables>;
export async function ownerBranch(db: TablesDb, principal: AuthPrincipal, branchId: string) {
  if (!principal.restaurantId) throw new ForbiddenException("Restaurant scope required");
  const branch = await db.selectFrom("branches")
    .select(["id", "name", "slug", "restaurant_id", "is_active"])
    .where("id", "=", branchId).where("restaurant_id", "=", principal.restaurantId).executeTakeFirst();
  if (!branch || !branch.is_active) throw new NotFoundException("Branch not found");
  const entitlements = await requireOperationalEntitlements(db, principal.restaurantId);
  return { branch, entitlements };
}
export async function lockRestaurant(db: TablesDb, principal: AuthPrincipal) {
  if (!principal.restaurantId) throw new ForbiddenException("Restaurant scope required");
  const row = await db.selectFrom("restaurants").select("id")
    .where("id", "=", principal.restaurantId).forUpdate().executeTakeFirst();
  if (!row) throw new NotFoundException("Restaurant not found");
}
export function requireQrConfig(config: RuntimeConfig): { key: string; origin: string } {
  if (!config.qrEncryptionKey || !config.customerAppOrigin) {
    throw new ServiceUnavailableException({ code: "QR_NOT_CONFIGURED",
      message: "Configure QR_TOKEN_ENCRYPTION_KEY and CUSTOMER_APP_ORIGIN before issuing QR codes" });
  }
  return { key: config.qrEncryptionKey, origin: config.customerAppOrigin };
}
