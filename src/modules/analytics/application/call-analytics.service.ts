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
  /** All counters are tenant scoped and aggregated in SQL, not paginated. */
  async overview(principal: AuthPrincipal): Promise<{
    branches: number; activeTables: number; onShiftEmployees: number;
    callsToday: number; waiterCallsToday: number; hookahCallsToday: number; noStaffCallsToday: number;
  }> {
    if (principal.role !== "RESTAURANT_OWNER" || !principal.restaurantId) {
      throw new ForbiddenException("Restaurant owner required");
    }
    const restaurantId = principal.restaurantId;
    const result = await sql<{
      branches: number; activeTables: number; onShiftEmployees: number;
      callsToday: number; waiterCallsToday: number; hookahCallsToday: number; noStaffCallsToday: number;
    }>`
      SELECT
        (SELECT count(*)::int FROM branches
          WHERE restaurant_id = ${restaurantId}::uuid AND is_active) AS "branches",
        (SELECT count(*)::int FROM restaurant_tables
          WHERE restaurant_id = ${restaurantId}::uuid AND is_active) AS "activeTables",
        (SELECT count(distinct user_id)::int FROM employee_shifts
          WHERE restaurant_id = ${restaurantId}::uuid
            AND ended_at IS NULL AND auto_end_at > now()) AS "onShiftEmployees",
        (SELECT count(*)::int FROM service_calls
          WHERE restaurant_id = ${restaurantId}::uuid
            AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS "callsToday",
        (SELECT count(*)::int FROM service_calls
          WHERE restaurant_id = ${restaurantId}::uuid AND type = 'waiter'
            AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS "waiterCallsToday",
        (SELECT count(*)::int FROM service_calls
          WHERE restaurant_id = ${restaurantId}::uuid AND type = 'hookah'
            AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS "hookahCallsToday",
        (SELECT count(*)::int FROM service_calls
          WHERE restaurant_id = ${restaurantId}::uuid AND delivery_state = 'no_staff'
            AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS "noStaffCallsToday"
    `.execute(this.database.db);
    return result.rows[0];
  }

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
