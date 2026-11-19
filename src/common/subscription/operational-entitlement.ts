import { ForbiddenException } from "@nestjs/common";
import type { Kysely, Transaction } from "kysely";
import type { DatabaseTables, EntitlementSnapshot, FeatureKey } from "../../database/database.types";

type DatabaseClient = Kysely<DatabaseTables> | Transaction<DatabaseTables>;

function deny(code: string, message: string): never {
  throw new ForbiddenException({ code, message });
}

/**
 * Shared server-side operational check. Call under a restaurant FOR UPDATE lock when
 * deciding quotas to avoid parallel writes bypassing the plan's limit.
 */
export async function requireOperationalEntitlements(
  database: DatabaseClient, restaurantId: string, feature?: FeatureKey,
): Promise<EntitlementSnapshot> {
  const restaurant = await database.selectFrom("restaurants").select("is_active")
    .where("id", "=", restaurantId).executeTakeFirst();
  if (!restaurant?.is_active) return deny("SUBSCRIPTION_INACTIVE", "Restaurant inactive");
  const subscription = await database.selectFrom("subscriptions")
    .select(["starts_at", "grace_ends_at", "entitlement_snapshot"])
    .where("restaurant_id", "=", restaurantId).where("status", "=", "active")
    .executeTakeFirst();
  const now = new Date();
  if (!subscription || !subscription.starts_at || !subscription.grace_ends_at
    || now < subscription.starts_at || now >= subscription.grace_ends_at
    || !subscription.entitlement_snapshot) {
    return deny("SUBSCRIPTION_INACTIVE", "Subscription inactive or expired");
  }
  const entitlements = subscription.entitlement_snapshot;
  if (feature && entitlements.features[feature] !== true) {
    return deny("PLAN_FEATURE_DISABLED", "Feature not included in current subscription");
  }
  return entitlements;
}
