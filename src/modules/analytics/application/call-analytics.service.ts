import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { sql } from "kysely";
import type { AuthPrincipal } from "../../../common/auth/principal";
import { requireOperationalEntitlements } from "../../../common/subscription/operational-entitlement";
import { DatabaseService } from "../../../database/database.service";
import { resolveReportWindow } from "../domain/report-window";
import type { CallAnalyticsDailyDto, CallAnalyticsQueryDto, CallAnalyticsReportDto } from "../presentation/analytics.dto";

const metrics = {
  totalCalls: sql<number>`count(*)::int`,
  waiterCalls: sql<number>`count(*) filter (where type='waiter')::int`,
  hookahCalls: sql<number>`count(*) filter (where type='hookah')::int`,
  routedCalls: sql<number>`count(*) filter (where delivery_state='queued')::int`,
  noStaffCalls: sql<number>`count(*) filter (where delivery_state='no_staff')::int`,
};
function emptyDay(date: string): CallAnalyticsDailyDto {
  return { date, totalCalls: 0, waiterCalls: 0, hookahCalls: 0, routedCalls: 0, noStaffCalls: 0 };
}
@Injectable()
export class CallAnalyticsService {
  constructor(private readonly database: DatabaseService) {}
  async report(principal: AuthPrincipal, query: CallAnalyticsQueryDto): Promise<CallAnalyticsReportDto> {
    if (principal.role !== "RESTAURANT_OWNER" || !principal.restaurantId) {
      throw new ForbiddenException("Restaurant owner required");
    }
    let window;
    try { window = resolveReportWindow(query.from, query.to); }
    catch (error: unknown) {
      if (error instanceof RangeError) throw new BadRequestException(error.message);
      throw error;
    }
    const restaurantId = principal.restaurantId;
    await requireOperationalEntitlements(this.database.db, restaurantId, "analytics");
    const branchId = query.branchId;
    if (branchId) {
      const ownBranch = await this.database.db.selectFrom("branches").select("id")
        .where("id", "=", branchId).where("restaurant_id", "=", restaurantId).executeTakeFirst();
      if (!ownBranch) throw new NotFoundException("Branch not found");
    }
    const scoped = this.database.db.selectFrom("service_calls")
      .where("restaurant_id", "=", restaurantId)
      .where("created_at", ">=", window.start).where("created_at", "<", window.end)
      .$if(branchId !== undefined, qb => qb.where("branch_id", "=", branchId!));
    const summary = await scoped.select([
      metrics.totalCalls.as("totalCalls"), metrics.waiterCalls.as("waiterCalls"),
      metrics.hookahCalls.as("hookahCalls"), metrics.routedCalls.as("routedCalls"),
      metrics.noStaffCalls.as("noStaffCalls"), sql<number>`count(distinct table_id)::int`.as("distinctTables"),
    ]).executeTakeFirstOrThrow();
    const dayExpr = sql<string>`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
    const rows = await scoped.select([
      dayExpr.as("date"), metrics.totalCalls.as("totalCalls"), metrics.waiterCalls.as("waiterCalls"),
      metrics.hookahCalls.as("hookahCalls"), metrics.routedCalls.as("routedCalls"),
      metrics.noStaffCalls.as("noStaffCalls"),
    ]).groupBy(dayExpr).orderBy("date", "asc").execute();
    const daily = new Map(rows.map(row => [row.date, row]));
    return { from: window.from, to: window.to, branchId: branchId ?? null,
      summary, daily: window.dates.map(date => daily.get(date) ?? emptyDay(date)) };
  }
}
