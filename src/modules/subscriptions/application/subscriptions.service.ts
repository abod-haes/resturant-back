import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from "@nestjs/common";
import { sql, type Selectable } from "kysely";
import { DatabaseService } from "../../../database/database.service";
import type { FeatureKey, SubscriptionsTable, SubscriptionPeriod } from "../../../database/database.types";
import type { AuthPrincipal } from "../../../common/auth/principal";
import type { ActivateSubscriptionDto, CreatePendingSubscriptionDto, RenewSubscriptionDto, SubscriptionDto } from "../presentation/subscriptions.dto";
import {
  addCalendarPeriod, addGraceDays, canOperate, effectiveSubscriptionStatus, planEntitlements,
} from "../domain/subscription-policy";

type SubscriptionRow = Selectable<SubscriptionsTable>;

function serialize(row: SubscriptionRow, now = new Date()): SubscriptionDto {
  const effectiveStatus = effectiveSubscriptionStatus(row, now);
  return {
    id: row.id, restaurantId: row.restaurant_id, planId: row.plan_id,
    period: row.period, effectiveStatus, canOperate: canOperate(effectiveStatus),
    startsAt: row.starts_at?.toISOString() ?? null,
    endsAt: row.ends_at?.toISOString() ?? null,
    graceEndsAt: row.grace_ends_at?.toISOString() ?? null,
    graceDays: row.grace_days, entitlements: row.entitlement_snapshot,
  };
}

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

@Injectable()
export class SubscriptionsService {
  constructor(private readonly database: DatabaseService) {}

  async createPending(restaurantId: string, input: CreatePendingSubscriptionDto,
    actor: AuthPrincipal, requestId?: string): Promise<SubscriptionDto> {
    return this.database.db.transaction().execute(async (trx) => {
      const restaurant = await trx.selectFrom("restaurants")
        .select(["id", "is_active"]).where("id", "=", restaurantId)
        .forUpdate().executeTakeFirst();
      if (!restaurant) throw new NotFoundException("Restaurant not found");
      if (!restaurant.is_active) throw conflict("RESTAURANT_DISABLED", "Restaurant is disabled");
      const plan = await trx.selectFrom("plans").select(["id", "is_active"])
        .where("id", "=", input.planId).executeTakeFirst();
      if (!plan || !plan.is_active) throw new BadRequestException({ code: "PLAN_UNAVAILABLE", message: "Plan is unavailable" });

      const existing = await trx.selectFrom("subscriptions")
        .select("id").where("restaurant_id", "=", restaurantId)
        .where("status", "=", "pending").executeTakeFirst();
      if (existing) throw conflict("SUBSCRIPTION_PENDING", "A pending subscription already exists");

      const pending = await trx.insertInto("subscriptions").values({
        restaurant_id: restaurantId, plan_id: input.planId, period: input.period,
        status: "pending", starts_at: null, ends_at: null, grace_ends_at: null,
        activated_by_user_id: null,
      }).returningAll().executeTakeFirstOrThrow();
      await trx.insertInto("audit_logs").values({
        actor_user_id: actor.id, restaurant_id: restaurantId, action: "subscription.created",
        entity_type: "subscription", entity_id: pending.id, request_id: requestId ?? null,
        metadata: { planId: input.planId, period: input.period },
      }).execute();
      return serialize(pending);
    });
  }

  async activate(id: string, input: ActivateSubscriptionDto,
    actor: AuthPrincipal, requestId?: string): Promise<SubscriptionDto> {
    return this.database.db.transaction().execute(async (trx) => {
      const subscription = await trx.selectFrom("subscriptions").selectAll()
        .where("id", "=", id).forUpdate().executeTakeFirst();
      if (!subscription) throw new NotFoundException("Subscription not found");
      if (subscription.status !== "pending") {
        throw conflict("SUBSCRIPTION_NOT_PENDING", "Only pending subscriptions can be activated");
      }
      await trx.selectFrom("restaurants").select("id")
        .where("id", "=", subscription.restaurant_id).forUpdate().executeTakeFirstOrThrow();
      const restaurant = await trx.selectFrom("restaurants").select("is_active")
        .where("id", "=", subscription.restaurant_id).executeTakeFirstOrThrow();
      if (!restaurant.is_active) throw conflict("RESTAURANT_DISABLED", "Restaurant is disabled");

      const active = await trx.selectFrom("subscriptions").selectAll()
        .where("restaurant_id", "=", subscription.restaurant_id)
        .where("status", "=", "active").forUpdate().executeTakeFirst();
      if (active) {
        const status = effectiveSubscriptionStatus(active, new Date());
        if (status !== "expired") throw conflict("SUBSCRIPTION_ALREADY_ACTIVE", "An active subscription exists");
        await trx.updateTable("subscriptions").set({ status: "expired" }).where("id", "=", active.id).execute();
      }

      const plan = await trx.selectFrom("plans").selectAll()
        .where("id", "=", subscription.plan_id).executeTakeFirst();
      if (!plan || !plan.is_active) throw new BadRequestException({ code: "PLAN_UNAVAILABLE", message: "Plan is unavailable" });
      const now = new Date();
      const startsAt = input.startsAt ? new Date(input.startsAt) : now;
      if (!Number.isFinite(startsAt.getTime())) throw new BadRequestException("Invalid startsAt");
      const endsAt = addCalendarPeriod(startsAt, subscription.period);
      const graceEndsAt = addGraceDays(endsAt, input.graceDays);
      const snapshot = planEntitlements(plan);
      const updated = await trx.updateTable("subscriptions").set({
        status: "active", starts_at: startsAt, ends_at: endsAt, grace_ends_at: graceEndsAt,
        grace_days: input.graceDays, entitlement_snapshot: snapshot, activated_by_user_id: actor.id,
      }).where("id", "=", id).returningAll().executeTakeFirstOrThrow();

      await trx.insertInto("subscription_terms").values({
        subscription_id: id, sequence: 1, plan_id: subscription.plan_id, period: subscription.period,
        starts_at: startsAt, ends_at: endsAt, grace_ends_at: graceEndsAt,
        entitlement_snapshot: snapshot, activated_by_user_id: actor.id,
      }).execute();
      await trx.insertInto("audit_logs").values({
        actor_user_id: actor.id, restaurant_id: subscription.restaurant_id,
        action: "subscription.activated", entity_type: "subscription", entity_id: id,
        request_id: requestId ?? null, metadata: {
          planId: plan.id, period: subscription.period, graceDays: input.graceDays,
          startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
        },
      }).execute();
      return serialize(updated, now);
    });
  }

  async renew(id: string, input: RenewSubscriptionDto,
    actor: AuthPrincipal, requestId?: string): Promise<SubscriptionDto> {
    return this.database.db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom("subscriptions").selectAll()
        .where("id", "=", id).forUpdate().executeTakeFirst();
      if (!current) throw new NotFoundException("Subscription not found");
      if (current.status !== "active" || !current.ends_at || !current.grace_ends_at) {
        throw conflict("SUBSCRIPTION_NOT_RENEWABLE", "Only activated subscriptions can be renewed");
      }
      const plan = await trx.selectFrom("plans").selectAll()
        .where("id", "=", current.plan_id).executeTakeFirst();
      if (!plan || !plan.is_active) throw new BadRequestException({ code: "PLAN_UNAVAILABLE", message: "Plan is unavailable" });

      const now = new Date();
      const inGraceOrActive = now < current.grace_ends_at;
      // During grace, backdate to original end so manual renewal cannot extend time for free.
      // After grace, start a new period today rather than charging the expired gap.
      const termStartsAt = inGraceOrActive ? current.ends_at : now;
      // The current subscription remains continuously active until its newly extended end.
      const startsAt = inGraceOrActive ? current.starts_at : now;
      const period: SubscriptionPeriod = input.period ?? current.period;
      const endsAt = addCalendarPeriod(termStartsAt, period);
      const graceEndsAt = addGraceDays(endsAt, input.graceDays);
      const snapshot = planEntitlements(plan);
      const latestTerm = await trx.selectFrom("subscription_terms").select("sequence")
        .where("subscription_id", "=", id).orderBy("sequence", "desc").executeTakeFirst();
      const sequence = (latestTerm?.sequence ?? 0) + 1;
      const updated = await trx.updateTable("subscriptions")
        .set({
          status: "active", period, starts_at: startsAt, ends_at: endsAt, grace_ends_at: graceEndsAt,
          grace_days: input.graceDays, entitlement_snapshot: snapshot, activated_by_user_id: actor.id,
        })
        .where("id", "=", id).returningAll().executeTakeFirstOrThrow();
      await trx.insertInto("subscription_terms").values({
        subscription_id: id, sequence, plan_id: current.plan_id, period,
        starts_at: termStartsAt, ends_at: endsAt, grace_ends_at: graceEndsAt,
        entitlement_snapshot: snapshot, activated_by_user_id: actor.id,
      }).execute();
      await trx.insertInto("audit_logs").values({
        actor_user_id: actor.id, restaurant_id: current.restaurant_id,
        action: "subscription.renewed", entity_type: "subscription", entity_id: id,
        request_id: requestId ?? null, metadata: {
          sequence, planId: current.plan_id, period, graceDays: input.graceDays,
          startsAt: termStartsAt.toISOString(), endsAt: endsAt.toISOString(),
        },
      }).execute();
      return serialize(updated, now);
    });
  }

  async currentForRestaurant(restaurantId: string): Promise<SubscriptionDto | null> {
    const rows = await this.database.db.selectFrom("subscriptions").selectAll()
      .where("restaurant_id", "=", restaurantId).orderBy(sql<number>`CASE WHEN status = 'active' THEN 0 ELSE 1 END`, "asc")
      .orderBy("created_at", "desc").limit(1).execute();
    return rows.length > 0 ? serialize(rows[0]) : null;
  }

  async assertOperational(restaurantId: string, feature?: FeatureKey): Promise<void> {
    const restaurant = await this.database.db.selectFrom("restaurants").select("is_active")
      .where("id", "=", restaurantId).executeTakeFirst();
    if (!restaurant?.is_active) {
      throw new ForbiddenException({ code: "SUBSCRIPTION_INACTIVE", message: "Restaurant is inactive" });
    }
    const current = await this.currentForRestaurant(restaurantId);
    if (!current || !current.canOperate || !current.entitlements) {
      throw new ForbiddenException({ code: "SUBSCRIPTION_INACTIVE", message: "Subscription inactive or expired" });
    }
    if (feature && !current.entitlements.features[feature]) {
      throw new ForbiddenException({ code: "PLAN_FEATURE_DISABLED", message: "Feature is not included in the subscription" });
    }
  }

}
