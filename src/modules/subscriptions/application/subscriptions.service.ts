import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from "@nestjs/common";
import { sql, type Selectable } from "kysely";
import { requireOperationalEntitlements } from "../../../common/subscription/operational-entitlement";
import { DatabaseService } from "../../../database/database.service";
import type { FeatureKey, SubscriptionsTable, SubscriptionPeriod } from "../../../database/database.types";
import type { AuthPrincipal } from "../../../common/auth/principal";
import type { ActivateSubscriptionDto, CreatePendingSubscriptionDto, RenewSubscriptionDto, SubscriptionDto, ListSubscriptionsQueryDto, SubscriptionListItemDto } from "../presentation/subscriptions.dto";
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

  /** Immediately terminate a pending or active subscription without deleting term history. */
  async cancel(id: string, actor: AuthPrincipal, requestId?: string): Promise<SubscriptionDto> {
    return this.database.db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom("subscriptions").selectAll()
        .where("id", "=", id).forUpdate().executeTakeFirst();
      if (!current) throw new NotFoundException("Subscription not found");
      if (current.status !== "active" && current.status !== "pending") {
        throw conflict("SUBSCRIPTION_NOT_CANCELLABLE", "Only active or pending subscriptions may be cancelled");
      }
      const cancelled = await trx.updateTable("subscriptions")
        .set({ status: "cancelled" }).where("id", "=", id)
        .returningAll().executeTakeFirstOrThrow();
      await trx.insertInto("audit_logs").values({
        actor_user_id: actor.id,
        restaurant_id: current.restaurant_id,
        action: "subscription.cancelled",
        entity_type: "subscription",
        entity_id: id,
        request_id: requestId ?? null,
        metadata: {
          previousStatus: current.status,
          planId: current.plan_id,
          terminatedAt: new Date().toISOString(),
        },
      }).execute();
      return serialize(cancelled);
    });
  }

  /** Present display labels in mutations as well as collection/detail responses. */
  async withNames(subscription: SubscriptionDto): Promise<SubscriptionDto> {
    const [restaurant, plan] = await Promise.all([
      this.database.db.selectFrom("restaurants").select(["name", "is_active"])
        .where("id", "=", subscription.restaurantId).executeTakeFirst(),
      this.database.db.selectFrom("plans").select("name")
        .where("id", "=", subscription.planId).executeTakeFirst(),
    ]);
    return {
      ...subscription,
      canOperate: subscription.canOperate && restaurant?.is_active === true,
      ...(restaurant ? { restaurantName: restaurant.name } : {}),
      ...(plan ? { planName: plan.name } : {}),
    };
  }

  /** Globally paginated subscriptions, with names joined in the database. */
  async list(query: ListSubscriptionsQueryDto): Promise<{ data: SubscriptionListItemDto[]; meta: { nextCursor: string | null; hasMore: boolean } }> {
    let builder = this.database.db.selectFrom("subscriptions as s")
      .innerJoin("restaurants as r", "r.id", "s.restaurant_id")
      .innerJoin("plans as p", "p.id", "s.plan_id")
      .selectAll("s").select(["r.name as restaurant_name", "p.name as plan_name", "r.is_active as restaurant_active"])
      .select(sql<string>`to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("cursor_timestamp"));
    if (query.restaurantId) builder = builder.where("s.restaurant_id", "=", query.restaurantId);
    if (query.planId) builder = builder.where("s.plan_id", "=", query.planId);
    if (query.status) builder = builder.where("s.status", "=", query.status);
    if (query.cursor) {
      let cursor: { timestamp: string; id: string };
      try {
        if (!/^[A-Za-z0-9_-]{1,500}$/.test(query.cursor)) throw new Error("invalid encoding");
        cursor = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")) as typeof cursor;
        if (!cursor || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.timestamp) ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.id)) throw new Error("invalid cursor");
      } catch { throw new BadRequestException("Invalid pagination cursor"); }
      builder = builder.where(sql<boolean>`(s.created_at, s.id) < (${cursor.timestamp}::timestamptz, ${cursor.id}::uuid)`);
    }
    const rows = await builder.orderBy("s.created_at", "desc").orderBy("s.id", "desc")
      .limit(query.limit + 1).execute();
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map(row => { const view = serialize(row); return { ...view, canOperate: view.canOperate && row.restaurant_active, restaurantName: row.restaurant_name, planName: row.plan_name }; }),
      meta: { hasMore, nextCursor: hasMore && last ? Buffer.from(JSON.stringify({
        timestamp: last.cursor_timestamp, id: last.id,
      })).toString("base64url") : null },
    };
  }
  async currentForRestaurant(restaurantId: string): Promise<SubscriptionDto | null> {
    const rows = await this.database.db.selectFrom("subscriptions as s")
      .innerJoin("restaurants as r", "r.id", "s.restaurant_id")
      .innerJoin("plans as p", "p.id", "s.plan_id")
      .selectAll("s").select(["r.name as restaurant_name", "p.name as plan_name", "r.is_active as restaurant_active"])
      .where("s.restaurant_id", "=", restaurantId)
      .orderBy(sql<number>`CASE WHEN s.status = 'active' THEN 0 ELSE 1 END`, "asc")
      .orderBy("s.created_at", "desc").limit(1).execute();
    if (!rows.length) return null;
    const view = serialize(rows[0]);
    return { ...view, canOperate: view.canOperate && rows[0].restaurant_active, restaurantName: rows[0].restaurant_name, planName: rows[0].plan_name };
  }

  async assertOperational(restaurantId: string, feature?: FeatureKey): Promise<void> {
    await requireOperationalEntitlements(this.database.db, restaurantId, feature);
  }
}
