import {
  ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { sql, type Selectable } from "kysely";
import type { AuthPrincipal } from "../../../common/auth/principal";
import { hashOpaqueToken, isOpaqueToken } from "../../../common/crypto/opaque-token";
import { activeQrTable } from "../../../common/qr/active-table";
import { decodeKeysetCursor, encodeKeysetCursor } from "../../../common/pagination/keyset";
import { requireOperationalEntitlements } from "../../../common/subscription/operational-entitlement";
import { DatabaseService } from "../../../database/database.service";
import type { ServiceCallsTable } from "../../../database/database.types";
import { cooldownSeconds, visitExpiresAt } from "../../../common/visits/visit-policy";
import type { CallDto, CreateCallDto, ListCallsQueryDto, OwnerAlertDto } from "../presentation/calls.dto";
import { effectiveRouting } from "./routing.service";

type CallRow = Selectable<ServiceCallsTable>;
const toCall = (row: CallRow): CallDto => ({
  id: row.id, tableId: row.table_id, type: row.kind,
  deliveryState: row.delivery_state, ownerAlerted: row.owner_alerted,
  createdAt: row.created_at.toISOString(),
});
function tenantId(principal: AuthPrincipal): string {
  if (!principal.restaurantId) throw new ForbiddenException("Restaurant scope required");
  return principal.restaurantId;
}

@Injectable()
export class CallsService {
  constructor(private readonly database: DatabaseService) {}

  async submit(input: CreateCallDto): Promise<CallDto> {
    if (!isOpaqueToken(input.sessionToken)) throw new UnauthorizedException({
      code: "SESSION_EXPIRED", message: "Visit session invalid",
    });
    return this.database.db.transaction().execute(async (trx) => {
      const located = await trx.selectFrom("visit_sessions").select(["id", "table_id"])
        .where("token_hash", "=", hashOpaqueToken(input.sessionToken)).executeTakeFirst();
      if (!located) throw new UnauthorizedException({
        code: "SESSION_EXPIRED", message: "Visit session invalid",
      });
      // The table row serializes cooldown + idempotency even when separate sessions and replicas race.
      await trx.selectFrom("restaurant_tables").select("id")
        .where("id", "=", located.table_id).forUpdate().executeTakeFirstOrThrow();
      const session = await trx.selectFrom("visit_sessions").selectAll()
        .where("id", "=", located.id).forUpdate().executeTakeFirstOrThrow();
      const now = new Date();
      if (session.expires_at <= now) throw new UnauthorizedException({
        code: "SESSION_EXPIRED", message: "Visit session expired",
      });
      const table = await activeQrTable(trx, session.qr_credential_id);
      if (session.qr_version !== table.qr_version || session.table_id !== table.table_id) {
        throw new UnauthorizedException({ code: "SESSION_EXPIRED", message: "Visit session revoked" });
      }
      await requireOperationalEntitlements(trx, session.restaurant_id, "menu");
      const feature = input.type === "waiter" ? "waiter_calls" : "hookah_calls";
      await requireOperationalEntitlements(trx, session.restaurant_id, feature);
      if (!table.calls_enabled) throw new ForbiddenException({
        code: "CALLS_DISABLED", message: "Calls are disabled for this table",
      });

      const existing = await trx.selectFrom("service_calls").selectAll()
        .where("session_id", "=", session.id)
        .where("idempotency_key", "=", input.idempotencyKey).executeTakeFirst();
      if (existing) {
        if (existing.kind !== input.type) throw new ConflictException({
          code: "IDEMPOTENCY_KEY_REUSED", message: "The key was used for a different call type",
        });
        return toCall(existing);
      }

      if (!session.first_call_confirmed && input.firstCallConfirmed !== true) {
        throw new ConflictException({ code: "FIRST_CALL_CONFIRMATION_REQUIRED",
          message: "Confirm the first call of this visit" });
      }
      const last = await trx.selectFrom("service_calls").select("created_at")
        .where("table_id", "=", table.table_id).where("kind", "=", input.type)
        .orderBy("created_at", "desc").limit(1).executeTakeFirst();
      if (last) {
        const retryAfterSeconds = cooldownSeconds(last.created_at, now);
        if (retryAfterSeconds > 0) {
          throw new HttpException({ code: "COOLDOWN_ACTIVE",
            message: "Please retry after the cooldown", details: { retryAfterSeconds } }, HttpStatus.TOO_MANY_REQUESTS);
        }
      }

      const mode = await effectiveRouting(trx, session.restaurant_id, session.branch_id);
      let staff = trx.selectFrom("users").innerJoin("employee_shifts", "employee_shifts.employee_user_id", "users.id")
        .select("users.id")
        .where("users.role", "=", "EMPLOYEE")
        .where("users.restaurant_id", "=", session.restaurant_id)
        .where("users.branch_id", "=", session.branch_id)
        .where("users.is_active", "=", true)
        .where("users.must_change_password", "=", false)
        .where("employee_shifts.branch_id", "=", session.branch_id)
        .where("employee_shifts.ended_at", "is", null)
        .where("employee_shifts.planned_ends_at", ">", now);
      if (mode === "department") staff = staff.where("users.department", "=", input.type);
      const recipients = await staff.execute();
      const deliveryState = recipients.length > 0 ? "queued" : "no_staff";
      const created = await trx.insertInto("service_calls").values({
        restaurant_id: session.restaurant_id, branch_id: session.branch_id,
        table_id: session.table_id, session_id: session.id,
        kind: input.type, idempotency_key: input.idempotencyKey,
        delivery_state: deliveryState, owner_alerted: recipients.length === 0,
      }).returningAll().executeTakeFirstOrThrow();

      if (recipients.length) {
        await trx.insertInto("call_recipients").values(recipients.map(({ id }) => ({
          call_id: created.id, employee_user_id: id,
        }))).execute();
        await trx.insertInto("call_delivery_outbox").values(recipients.map(({ id }) => ({
          call_id: created.id, employee_user_id: id, sent_at: null,
        }))).execute();
      } else {
        await trx.insertInto("owner_alerts").values({
          restaurant_id: session.restaurant_id, branch_id: session.branch_id,
          call_id: created.id, read_at: null,
        }).execute();
      }
      await trx.updateTable("visit_sessions").set({
        first_call_confirmed: true, last_activity_at: now, expires_at: visitExpiresAt(now),
      }).where("id", "=", session.id).execute();
      return toCall(created);
    });
  }

  async ownerCalls(principal: AuthPrincipal, query: ListCallsQueryDto, branchId?: string) {
    const restaurantId = tenantId(principal);
    await requireOperationalEntitlements(this.database.db, restaurantId);
    let select = this.database.db.selectFrom("service_calls").selectAll()
      .select(sql<string>`to_char(service_calls.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("cursor_timestamp"))
      .where("restaurant_id", "=", restaurantId);
    if (branchId) {
      const branch = await this.database.db.selectFrom("branches").select("id")
        .where("id", "=", branchId).where("restaurant_id", "=", restaurantId).executeTakeFirst();
      if (!branch) throw new NotFoundException("Branch not found");
      select = select.where("branch_id", "=", branchId);
    }
    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor);
      select = select.where(sql<boolean>`(service_calls.created_at,service_calls.id) < (${cursor.timestamp}::timestamptz,${cursor.id}::uuid)`);
    }
    const rows = await select.orderBy("created_at", "desc").orderBy("id", "desc")
      .limit(query.limit + 1).execute();
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const hasMore = rows.length > query.limit;
    return { data: page.map(toCall), meta: { hasMore, nextCursor: hasMore && last
      ? encodeKeysetCursor({ timestamp: last.cursor_timestamp, id: last.id }) : null } };
  }

  async employeeCalls(principal: AuthPrincipal, query: ListCallsQueryDto) {
    if (!principal.branchId) throw new ForbiddenException("Employee scope required");
    await requireOperationalEntitlements(this.database.db, tenantId(principal));
    let select = this.database.db.selectFrom("call_recipients")
      .innerJoin("service_calls", "service_calls.id", "call_recipients.call_id")
      .selectAll("service_calls")
      .select(sql<string>`to_char(service_calls.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("cursor_timestamp"))
      .where("call_recipients.employee_user_id", "=", principal.id)
      .where("service_calls.branch_id", "=", principal.branchId);
    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor);
      select = select.where(sql<boolean>`(service_calls.created_at,service_calls.id) < (${cursor.timestamp}::timestamptz,${cursor.id}::uuid)`);
    }
    const rows = await select.orderBy("service_calls.created_at", "desc")
      .orderBy("service_calls.id", "desc").limit(query.limit + 1).execute();
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const hasMore = rows.length > query.limit;
    return { data: page.map(toCall), meta: { hasMore, nextCursor: hasMore && last
      ? encodeKeysetCursor({ timestamp: last.cursor_timestamp, id: last.id }) : null } };
  }

  async ownerAlerts(principal: AuthPrincipal, limit: number): Promise<OwnerAlertDto[]> {
    const restaurantId = tenantId(principal);
    await requireOperationalEntitlements(this.database.db, restaurantId);
    const rows = await this.database.db.selectFrom("owner_alerts")
      .selectAll().where("restaurant_id", "=", restaurantId)
      .orderBy("created_at", "desc").limit(limit).execute();
    return rows.map((row) => ({ id: row.id, callId: row.call_id, branchId: row.branch_id,
      createdAt: row.created_at.toISOString(), readAt: row.read_at?.toISOString() ?? null }));
  }

  async markAlertRead(principal: AuthPrincipal, id: string): Promise<OwnerAlertDto> {
    const restaurantId = tenantId(principal);
    await requireOperationalEntitlements(this.database.db, restaurantId);
    const row = await this.database.db.updateTable("owner_alerts")
      .set({ read_at: new Date() }).where("id", "=", id)
      .where("restaurant_id", "=", restaurantId)
      .returningAll().executeTakeFirst();
    if (!row) throw new NotFoundException("Alert not found");
    return { id: row.id, callId: row.call_id, branchId: row.branch_id,
      createdAt: row.created_at.toISOString(), readAt: row.read_at?.toISOString() ?? null };
  }
}
