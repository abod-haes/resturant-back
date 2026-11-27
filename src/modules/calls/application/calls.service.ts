import { Inject } from "@nestjs/common";
import { RUNTIME_CONFIG, type RuntimeConfig } from "../../../common/config/runtime-config";
import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { sql, type Selectable } from "kysely";
import { appendRealtimeEvents } from "../../../common/realtime/realtime-outbox";
import { DatabaseService } from "../../../database/database.service";
import type { AuthPrincipal } from "../../../common/auth/principal";
import { callIsAvailable } from "../../../common/calls/call-settings";
import { CALL_COOLDOWN_MS, requireLiveVisit, VISIT_IDLE_MS, visitHash } from "../../../common/calls/visit-policy";
import { decodeKeysetCursor, encodeKeysetCursor } from "../../../common/pagination/keyset";
import { requireOperationalEntitlements } from "../../../common/subscription/operational-entitlement";
import type { ServiceCallsTable } from "../../../database/database.types";
import type { CallDataDto, CallHistoryDto, CreateCallDto, ListCallsQueryDto, AlertDto } from "../presentation/calls.dto";

type CallRow = Selectable<ServiceCallsTable>;
function toCall(row: CallRow): CallDataDto {
  return {
    id: row.id, type: row.type, deliveryState: row.delivery_state,
    recipientsCount: row.recipients_count, ownerAlerted: row.owner_alerted,
    createdAt: row.created_at.toISOString(), firstCallNeedsConfirmation: false,
  };
}
function toHistory(row: CallRow & { table_label?: string | null; branch_name?: string | null }): CallHistoryDto {
  return { id: row.id, branchId: row.branch_id, tableId: row.table_id,
    tableLabel: row.table_label ?? null, branchName: row.branch_name ?? null, type: row.type,
    deliveryState: row.delivery_state, recipientsCount: row.recipients_count,
    ownerAlerted: row.owner_alerted, createdAt: row.created_at.toISOString() };
}
function requireTenant(principal: AuthPrincipal): string {
  if (!principal.restaurantId) throw new ForbiddenException("Restaurant scope required");
  return principal.restaurantId;
}

@Injectable()
export class CallsService {
  constructor(private readonly database: DatabaseService, @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  async create(input: CreateCallDto, origin?: string): Promise<CallDataDto> {
    const hash = visitHash(input.sessionToken);
    return this.database.db.transaction().execute(async trx => {
      const initial = await trx.selectFrom("visit_sessions")
        .select(["id","table_id"]).where("token_hash", "=", hash).executeTakeFirst();
      if (!initial) throw new UnauthorizedException({ code: "SESSION_EXPIRED", message: "Visit session not found" });
      // Lock table first; cooldown is global across every browser visit/session.
      // This also serializes with table archive, disable, QR rotation and new session issuance.
      await trx.selectFrom("restaurant_tables").select("id")
        .where("id", "=", initial.table_id).forUpdate().executeTakeFirstOrThrow();
      const { session, table, entitlements, settings } = await requireLiveVisit(trx, input.sessionToken, origin, this.config.restaurantBaseDomain);
      if (!table.calls_enabled || !settings.enabled) {
        throw new ForbiddenException({ code: "CALLS_DISABLED", message: "Calls are disabled for this table" });
      }
      if (!callIsAvailable(input.type, table.calls_enabled, settings, entitlements)) {
        throw new ForbiddenException({ code: "CALL_TYPE_DISABLED", message: "Call type is not available" });
      }
      const previous = await trx.selectFrom("service_calls").selectAll()
        .where("session_id", "=", session.id).where("idempotency_key", "=", input.idempotencyKey)
        .executeTakeFirst();
      if (previous) {
        if (previous.type !== input.type) throw new ConflictException({
          code: "IDEMPOTENCY_KEY_REUSED", message: "Idempotency key already used with a different call type",
        });
        return toCall(previous);
      }
      if (!session.first_call_confirmed && input.confirmFirstCall !== true) {
        throw new ConflictException({
          code: "FIRST_CALL_CONFIRMATION_REQUIRED",
          message: "Confirm the first call in this visit before sending",
        });
      }
      const now = new Date();
      const last = await trx.selectFrom("service_calls").select(["id","created_at"])
        .where("table_id", "=", session.table_id).where("type", "=", input.type)
        .orderBy("created_at", "desc").limit(1).executeTakeFirst();
      if (last && now.getTime() - last.created_at.getTime() < CALL_COOLDOWN_MS) {
        const retryAfterSeconds = Math.ceil((CALL_COOLDOWN_MS - (now.getTime() - last.created_at.getTime())) / 1000);
        throw new HttpException({
          code: "COOLDOWN_ACTIVE", message: "Please retry after cooldown", details: { retryAfterSeconds },
        }, 429);
      }
      const candidates = await trx.selectFrom("employee_shifts")
        .innerJoin("users", "users.id", "employee_shifts.user_id")
        .innerJoin("branches", "branches.id", "employee_shifts.branch_id")
        .select("users.id as user_id").distinct()
        .where("employee_shifts.branch_id", "=", session.branch_id)
        .where("employee_shifts.restaurant_id", "=", session.restaurant_id)
        .where("employee_shifts.ended_at", "is", null)
        .where("employee_shifts.auto_end_at", ">", now)
        .where("users.is_active", "=", true).where("users.archived_at", "is", null)
        .where("users.role", "=", "EMPLOYEE").where("users.must_change_password", "=", false)
        .whereRef("users.restaurant_id", "=", "employee_shifts.restaurant_id")
        .whereRef("users.branch_id", "=", "employee_shifts.branch_id")
        .whereRef("users.department", "=", "employee_shifts.department")
        .where("branches.is_active", "=", true)
        .where("branches.restaurant_id", "=", session.restaurant_id)
        .$if(settings.routingMode === "department_on_shift", qb =>
          qb.where("employee_shifts.department", "=", input.type))
        .execute();
      const count = candidates.length;
      const state = count > 0 ? "queued" as const : "no_staff" as const;
      const call = await trx.insertInto("service_calls").values({
        restaurant_id: session.restaurant_id, branch_id: session.branch_id,
        table_id: session.table_id, session_id: session.id, type: input.type,
        idempotency_key: input.idempotencyKey, delivery_state: state,
        recipients_count: count, owner_alerted: count === 0,
      }).returningAll().executeTakeFirstOrThrow();
      if (count) {
        await trx.insertInto("call_outbox")
          .values(candidates.map(employee => ({ call_id: call.id, recipient_user_id: employee.user_id,
            last_attempt_at: null }))).execute();
      } else {
        await trx.insertInto("owner_alerts").values({
          restaurant_id: session.restaurant_id, branch_id: session.branch_id,
          call_id: call.id, type: "no_staff", viewed_at: null,
        }).execute();
      }
      const payload = { callId: call.id, branchId: call.branch_id, tableId: call.table_id,
        type: call.type, deliveryState: call.delivery_state, recipientsCount: count,
        createdAt: call.created_at.toISOString() };
      await appendRealtimeEvents(trx, session.restaurant_id, [
        { branchId: session.branch_id, recipientUserId: null, type: "call.created", payload },
        ...candidates.map(employee => ({
          branchId: session.branch_id, recipientUserId: employee.user_id,
          type: "call.created" as const, payload,
        })),
        ...(count === 0 ? [{
          branchId: session.branch_id, recipientUserId: null,
          type: "owner.alert.created" as const,
          payload: { callId: call.id, branchId: session.branch_id, type: "no_staff" },
        }] : []),
      ]);
      await trx.updateTable("visit_sessions").set({
        first_call_confirmed: true, last_activity_at: now,
        expires_at: new Date(now.getTime() + VISIT_IDLE_MS),
      }).where("id", "=", session.id).execute();
      return toCall(call);
    });
  }

  async ownerHistory(principal: AuthPrincipal, query: ListCallsQueryDto) {
    const restaurantId = requireTenant(principal);
    await requireOperationalEntitlements(this.database.db, restaurantId);
    let qb = this.database.db.selectFrom("service_calls").selectAll()
      .select([
        sql<string>`(SELECT t.label FROM restaurant_tables t WHERE t.id = service_calls.table_id)`.as("table_label"),
        sql<string>`(SELECT b.name FROM branches b WHERE b.id = service_calls.branch_id)`.as("branch_name"),
      ])
      .select(sql<string>`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("cursor_timestamp"))
      .where("restaurant_id", "=", restaurantId);
    if (query.branchId) {
      const branch = await this.database.db.selectFrom("branches").select("id")
        .where("id", "=", query.branchId).where("restaurant_id", "=", restaurantId).executeTakeFirst();
      if (!branch) throw new NotFoundException("Branch not found");
      qb = qb.where("branch_id", "=", query.branchId);
    }
    if (query.type) qb = qb.where("type", "=", query.type);
    if (query.cursor) {
      const c = decodeKeysetCursor(query.cursor);
      qb = qb.where(sql<boolean>`(created_at,id) < (${c.timestamp}::timestamptz,${c.id}::uuid)`);
    }
    const rows = await qb.orderBy("created_at", "desc").orderBy("id", "desc")
      .limit(query.limit + 1).execute();
    const hasMore = rows.length > query.limit, page = rows.slice(0, query.limit), last = page.at(-1);
    return { data: page.map(toHistory), meta: { hasMore, nextCursor: hasMore && last
      ? encodeKeysetCursor({ timestamp: last.cursor_timestamp, id: last.id }) : null } };
  }

  async ownerAlerts(principal: AuthPrincipal, query: ListCallsQueryDto) {
    const restaurantId = requireTenant(principal);
    await requireOperationalEntitlements(this.database.db, restaurantId);
    let qb = this.database.db.selectFrom("owner_alerts")
      .selectAll()
      .select(sql<string>`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("cursor_timestamp"))
      .where("restaurant_id", "=", restaurantId);
    if (query.branchId) {
      const branch = await this.database.db.selectFrom("branches").select("id")
        .where("id", "=", query.branchId).where("restaurant_id", "=", restaurantId).executeTakeFirst();
      if (!branch) throw new NotFoundException("Branch not found");
      qb = qb.where("branch_id", "=", query.branchId);
    }
    if (query.cursor) {
      const c = decodeKeysetCursor(query.cursor);
      qb = qb.where(sql<boolean>`(created_at,id) < (${c.timestamp}::timestamptz,${c.id}::uuid)`);
    }
    const rows = await qb.orderBy("created_at", "desc").orderBy("id", "desc")
      .limit(query.limit + 1).execute();
    const hasMore = rows.length > query.limit, page = rows.slice(0, query.limit), last = page.at(-1);
    const data: AlertDto[] = page.map(row => ({
      id: row.id, branchId: row.branch_id, callId: row.call_id,
      type: row.type, createdAt: row.created_at.toISOString(),
    }));
    return { data, meta: { hasMore, nextCursor: hasMore && last
      ? encodeKeysetCursor({ timestamp: last.cursor_timestamp, id: last.id }) : null } };
  }

  async employeeHistory(principal: AuthPrincipal, query: ListCallsQueryDto) {
    if (principal.role !== "EMPLOYEE" || !principal.restaurantId || !principal.branchId) {
      throw new ForbiddenException("Employee scope required");
    }
    await requireOperationalEntitlements(this.database.db, principal.restaurantId);
    let qb = this.database.db.selectFrom("service_calls")
      .innerJoin("call_outbox", "call_outbox.call_id", "service_calls.id")
      .innerJoin("restaurant_tables", "restaurant_tables.id", "service_calls.table_id")
      .innerJoin("branches", "branches.id", "service_calls.branch_id")
      .selectAll("service_calls")
      .select(["restaurant_tables.label as table_label", "branches.name as branch_name"])
      .select(sql<string>`to_char(service_calls.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("cursor_timestamp"))
      .where("call_outbox.recipient_user_id", "=", principal.id)
      .where("service_calls.branch_id", "=", principal.branchId)
      .where("service_calls.restaurant_id", "=", principal.restaurantId);
    if (query.type) qb = qb.where("service_calls.type", "=", query.type);
    if (query.cursor) {
      const c = decodeKeysetCursor(query.cursor);
      qb = qb.where(sql<boolean>`(service_calls.created_at,service_calls.id) < (${c.timestamp}::timestamptz,${c.id}::uuid)`);
    }
    const rows = await qb.orderBy("service_calls.created_at", "desc").orderBy("service_calls.id", "desc")
      .limit(query.limit + 1).execute();
    const hasMore = rows.length > query.limit, page = rows.slice(0, query.limit), last = page.at(-1);
    return { data: page.map(toHistory), meta: { hasMore, nextCursor: hasMore && last
      ? encodeKeysetCursor({ timestamp: last.cursor_timestamp, id: last.id }) : null } };
  }
}
