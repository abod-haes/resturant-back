import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { sql, type Selectable } from "kysely";
import { randomUUID } from "node:crypto";
import { appendRealtimeEvents } from "../../../common/realtime/realtime-outbox";
import { DatabaseService } from "../../../database/database.service";
import type { AuthPrincipal } from "../../../common/auth/principal";
import { hashPassword } from "../../../common/crypto/password";
import { requireOperationalEntitlements } from "../../../common/subscription/operational-entitlement";
import { decodeKeysetCursor, encodeKeysetCursor } from "../../../common/pagination/keyset";
import type { EmployeeShiftsTable, UsersTable } from "../../../database/database.types";
import type {
  CreateEmployeeDto, EmployeeDto, ListEmployeesQueryDto, PatchEmployeeDto, ShiftDto,
} from "../presentation/employees.dto";
import { effectiveCallSettings } from "../../../common/calls/call-settings";

function ownerRestaurant(principal: AuthPrincipal): string {
  if (!principal.restaurantId) throw new ForbiddenException("Restaurant owner scope required");
  return principal.restaurantId;
}
function toEmployee(row: Selectable<UsersTable>): EmployeeDto {
  if (!row.branch_id || !row.department) throw new Error("Employee is missing branch or department");
  return { id: row.id, username: row.username, name: row.display_name, branchId: row.branch_id,
    department: row.department, isActive: row.is_active, mustChangePassword: row.must_change_password,
    createdAt: row.created_at.toISOString() };
}
function toShift(row: Selectable<EmployeeShiftsTable>): ShiftDto {
  return { id: row.id, userId: row.user_id, branchId: row.branch_id, department: row.department,
    startedAt: row.started_at.toISOString(), autoEndAt: row.auto_end_at.toISOString(),
    endedAt: row.ended_at?.toISOString() ?? null };
}
function isUsernameConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505"
    && "constraint" in error && error.constraint === "users_username_ci_unique";
}
@Injectable()
export class EmployeesService {
  constructor(private readonly database: DatabaseService) {}

  async create(input: CreateEmployeeDto, principal: AuthPrincipal, requestId?: string): Promise<EmployeeDto> {
    const restaurantId = ownerRestaurant(principal);
    const password = await hashPassword(input.initialPassword);
    try {
      return await this.database.db.transaction().execute(async trx => {
        const tenant = await trx.selectFrom("restaurants").select("id")
          .where("id", "=", restaurantId).forUpdate().executeTakeFirst();
        if (!tenant) throw new NotFoundException("Restaurant not found");
        const entitlements = await requireOperationalEntitlements(trx, restaurantId);
        const branch = await trx.selectFrom("branches").select(["id", "is_active"])
          .where("id", "=", input.branchId).where("restaurant_id", "=", restaurantId).executeTakeFirst();
        if (!branch?.is_active) throw new NotFoundException("Branch not found");
        const count = await trx.selectFrom("users").select(sql<number>`count(*)::int`.as("count"))
          .where("restaurant_id", "=", restaurantId).where("role", "=", "EMPLOYEE")
          .where("archived_at", "is", null).executeTakeFirstOrThrow();
        if (count.count >= entitlements.maxEmployees) {
          throw new ForbiddenException({ code: "PLAN_LIMIT_REACHED", message: "Employee plan limit reached" });
        }
        const row = await trx.insertInto("users").values({
          id: randomUUID(), username: input.username, display_name: input.name.trim(),
          password_hash: password, role: "EMPLOYEE", restaurant_id: restaurantId,
          branch_id: input.branchId, department: input.department, must_change_password: true,
          is_active: true,
        }).returningAll().executeTakeFirstOrThrow();
        await trx.insertInto("audit_logs").values({
          actor_user_id: principal.id, restaurant_id: restaurantId, action: "employee.created",
          entity_type: "user", entity_id: row.id, request_id: requestId ?? null,
          metadata: { branchId: row.branch_id, department: row.department },
        }).execute();
        return toEmployee(row);
      });
    } catch (error) {
      if (isUsernameConflict(error)) throw new ConflictException({
        code: "EMPLOYEE_USERNAME_TAKEN", message: "Employee username already in use",
      });
      throw error;
    }
  }

  async list(query: ListEmployeesQueryDto, principal: AuthPrincipal) {
    const restaurantId = ownerRestaurant(principal);
    await requireOperationalEntitlements(this.database.db, restaurantId);
    if (query.branchId) {
      const branch = await this.database.db.selectFrom("branches").select("id")
        .where("id", "=", query.branchId).where("restaurant_id", "=", restaurantId).executeTakeFirst();
      if (!branch) throw new NotFoundException("Branch not found");
    }
    let qb = this.database.db.selectFrom("users").selectAll()
      .select(sql<string>`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("cursor_timestamp"))
      .where("restaurant_id", "=", restaurantId).where("role", "=", "EMPLOYEE")
      .where("archived_at", "is", null);
    if (query.branchId) qb = qb.where("branch_id", "=", query.branchId);
    if (query.cursor) {
      const c = decodeKeysetCursor(query.cursor);
      qb = qb.where(sql<boolean>`(created_at,id) < (${c.timestamp}::timestamptz,${c.id}::uuid)`);
    }
    const rows = await qb.orderBy("created_at", "desc").orderBy("id", "desc").limit(query.limit + 1).execute();
    const hasMore = rows.length > query.limit, page = rows.slice(0, query.limit), last = page.at(-1);
    return { data: page.map(toEmployee), meta: { hasMore, nextCursor: hasMore && last
      ? encodeKeysetCursor({ timestamp: last.cursor_timestamp, id: last.id }) : null } };
  }

  async patch(id: string, input: PatchEmployeeDto, principal: AuthPrincipal, requestId?: string) {
    if (!Object.keys(input).length) throw new BadRequestException("At least one employee field required");
    const restaurantId = ownerRestaurant(principal);
    return this.database.db.transaction().execute(async trx => {
      const tenant = await trx.selectFrom("restaurants").select("id")
        .where("id", "=", restaurantId).forUpdate().executeTakeFirst();
      if (!tenant) throw new NotFoundException("Restaurant not found");
      await requireOperationalEntitlements(trx, restaurantId);
      const employee = await trx.selectFrom("users").selectAll()
        .where("id", "=", id).where("restaurant_id", "=", restaurantId)
        .where("role", "=", "EMPLOYEE").where("archived_at", "is", null).forUpdate().executeTakeFirst();
      if (!employee) throw new NotFoundException("Employee not found");
      if (input.department && input.department !== employee.department) {
        const live = await trx.selectFrom("employee_shifts").select("id")
          .where("user_id", "=", id).where("ended_at", "is", null)
          .where("auto_end_at", ">", new Date()).executeTakeFirst();
        if (live) throw new ConflictException({ code: "SHIFT_ACTIVE", message: "End shift before changing department" });
      }
      if (input.isActive === false) {
        const now = new Date();
        await trx.updateTable("employee_shifts").set({ ended_at: now, ended_by_user_id: principal.id })
          .where("user_id", "=", id).where("ended_at", "is", null).execute();
        await trx.updateTable("auth_sessions").set({ revoked_at: now })
          .where("user_id", "=", id).where("revoked_at", "is", null).execute();
      }
      const patch: { display_name?: string; department?: "waiter" | "hookah"; is_active?: boolean } = {};
      if (input.name !== undefined) patch.display_name = input.name.trim();
      if (input.department !== undefined) patch.department = input.department;
      if (input.isActive !== undefined) patch.is_active = input.isActive;
      const updated = await trx.updateTable("users").set(patch).where("id", "=", id)
        .returningAll().executeTakeFirstOrThrow();
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: restaurantId, action: "employee.updated",
        entity_type: "user", entity_id: id, request_id: requestId ?? null,
        metadata: { fields: Object.keys(patch).sort() },
      }).execute();
      return toEmployee(updated);
    });
  }

  async resetPassword(id: string, newPassword: string, principal: AuthPrincipal, requestId?: string) {
    const restaurantId = ownerRestaurant(principal);
    const password = await hashPassword(newPassword);
    await this.database.db.transaction().execute(async trx => {
      const employee = await trx.selectFrom("users").select("id")
        .where("id", "=", id).where("role", "=", "EMPLOYEE")
        .where("restaurant_id", "=", restaurantId).where("archived_at", "is", null)
        .forUpdate().executeTakeFirst();
      if (!employee) throw new NotFoundException("Employee not found");
      await requireOperationalEntitlements(trx, restaurantId);
      await trx.updateTable("users").set({ password_hash: password, must_change_password: true })
        .where("id", "=", id).execute();
      await trx.updateTable("auth_sessions").set({ revoked_at: new Date() })
        .where("user_id", "=", id).where("revoked_at", "is", null).execute();
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: restaurantId,
        action: "employee.password_reset", entity_type: "user", entity_id: id,
        request_id: requestId ?? null, metadata: {},
      }).execute();
    });
    return { reset: true };
  }

  async archive(id: string, principal: AuthPrincipal, requestId?: string) {
    const restaurantId = ownerRestaurant(principal);
    await this.database.db.transaction().execute(async trx => {
      const tenant = await trx.selectFrom("restaurants").select("id")
        .where("id", "=", restaurantId).forUpdate().executeTakeFirst();
      if (!tenant) throw new NotFoundException("Restaurant not found");
      await requireOperationalEntitlements(trx, restaurantId);
      const now = new Date();
      const row = await trx.updateTable("users").set({ archived_at: now, is_active: false })
        .where("id", "=", id).where("restaurant_id", "=", restaurantId)
        .where("role", "=", "EMPLOYEE").where("archived_at", "is", null).returning("id").executeTakeFirst();
      if (!row) throw new NotFoundException("Employee not found");
      await trx.updateTable("employee_shifts").set({ ended_at: now, ended_by_user_id: principal.id })
        .where("user_id", "=", id).where("ended_at", "is", null).execute();
      await trx.updateTable("auth_sessions").set({ revoked_at: now })
        .where("user_id", "=", id).where("revoked_at", "is", null).execute();
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: restaurantId, action: "employee.archived",
        entity_type: "user", entity_id: id, request_id: requestId ?? null, metadata: {},
      }).execute();
    });
    return { archived: true };
  }

  async startShift(principal: AuthPrincipal): Promise<ShiftDto> {
    const restaurantId = principal.restaurantId;
    const branchId = principal.branchId;
    const department = principal.department;
    if (principal.role !== "EMPLOYEE" || !restaurantId || !branchId || !department) {
      throw new ForbiddenException("Employee role required");
    }
    return this.database.db.transaction().execute(async trx => {
      const employee = await trx.selectFrom("users").select(["id", "is_active", "archived_at"])
        .where("id", "=", principal.id).forUpdate().executeTakeFirst();
      if (!employee?.is_active || employee.archived_at) throw new ForbiddenException("Employee inactive");
      const branch = await trx.selectFrom("branches").select("is_active")
        .where("id", "=", branchId)
        .where("restaurant_id", "=", restaurantId).executeTakeFirst();
      if (!branch?.is_active) throw new ForbiddenException("Branch inactive");
      await requireOperationalEntitlements(trx, restaurantId,
        department === "waiter" ? "waiter_calls" : "hookah_calls");
      const now = new Date();
      await trx.updateTable("employee_shifts").set({ ended_at: sql`auto_end_at` })
        .where("user_id", "=", principal.id).where("ended_at", "is", null)
        .where("auto_end_at", "<=", now).execute();
      const open = await trx.selectFrom("employee_shifts").selectAll()
        .where("user_id", "=", principal.id).where("ended_at", "is", null).executeTakeFirst();
      if (open) throw new ConflictException({ code: "SHIFT_ALREADY_ACTIVE", message: "Employee already on shift" });
      const settings = await effectiveCallSettings(trx, restaurantId, branchId);
      const shift = await trx.insertInto("employee_shifts").values({
        user_id: principal.id, restaurant_id: restaurantId, branch_id: branchId,
        department: department,
        auto_end_at: new Date(now.getTime() + settings.shiftAutoEndMinutes * 60_000),
        ended_at: null, ended_by_user_id: null,
      }).returningAll().executeTakeFirstOrThrow();
      await appendRealtimeEvents(trx, shift.restaurant_id, [
        { branchId: shift.branch_id, recipientUserId: null, type: "shift.updated",
          payload: { shiftId: shift.id, employeeId: shift.user_id,
            branchId: shift.branch_id, state: "started" } },
        { branchId: shift.branch_id, recipientUserId: shift.user_id, type: "shift.updated",
          payload: { shiftId: shift.id, employeeId: shift.user_id,
            branchId: shift.branch_id, state: "started" } },
      ]);
      return toShift(shift);
    });
  }

  async currentShift(principal: AuthPrincipal): Promise<ShiftDto | null> {
    if (principal.role !== "EMPLOYEE") throw new ForbiddenException();
    const row = await this.database.db.selectFrom("employee_shifts").selectAll()
      .where("user_id", "=", principal.id).where("ended_at", "is", null)
      .where("auto_end_at", ">", new Date()).executeTakeFirst();
    return row ? toShift(row) : null;
  }

  async endShift(principal: AuthPrincipal) {
    if (principal.role !== "EMPLOYEE") throw new ForbiddenException();
    return this.database.db.transaction().execute(async trx => {
      const employee = await trx.selectFrom("users").select("id")
        .where("id", "=", principal.id).forUpdate().executeTakeFirst();
      if (!employee) throw new NotFoundException();
      const row = await trx.updateTable("employee_shifts")
        .set({ ended_at: new Date(), ended_by_user_id: principal.id })
        .where("user_id", "=", principal.id).where("ended_at", "is", null)
        .returningAll().executeTakeFirst();
      if (!row) throw new ConflictException({ code: "SHIFT_NOT_ACTIVE", message: "No active shift" });
      await appendRealtimeEvents(trx, row.restaurant_id, [
        { branchId: row.branch_id, recipientUserId: null, type: "shift.updated",
          payload: { shiftId: row.id, employeeId: row.user_id,
            branchId: row.branch_id, state: "ended" } },
        { branchId: row.branch_id, recipientUserId: row.user_id, type: "shift.updated",
          payload: { shiftId: row.id, employeeId: row.user_id,
            branchId: row.branch_id, state: "ended" } },
      ]);
      return toShift(row);
    });
  }

  async forceEndShift(employeeId: string, principal: AuthPrincipal, requestId?: string) {
    const restaurantId = ownerRestaurant(principal);
    return this.database.db.transaction().execute(async trx => {
      const employee = await trx.selectFrom("users").select("id")
        .where("id", "=", employeeId).where("restaurant_id", "=", restaurantId)
        .where("role", "=", "EMPLOYEE").executeTakeFirst();
      if (!employee) throw new NotFoundException("Employee not found");
      await requireOperationalEntitlements(trx, restaurantId);
      const row = await trx.updateTable("employee_shifts")
        .set({ ended_at: new Date(), ended_by_user_id: principal.id })
        .where("user_id", "=", employeeId).where("ended_at", "is", null)
        .returningAll().executeTakeFirst();
      if (!row) throw new ConflictException({ code: "SHIFT_NOT_ACTIVE", message: "No open shift" });
      await appendRealtimeEvents(trx, row.restaurant_id, [
        { branchId: row.branch_id, recipientUserId: null, type: "shift.updated",
          payload: { shiftId: row.id, employeeId: row.user_id,
            branchId: row.branch_id, state: "ended" } },
        { branchId: row.branch_id, recipientUserId: row.user_id, type: "shift.updated",
          payload: { shiftId: row.id, employeeId: row.user_id,
            branchId: row.branch_id, state: "ended" } },
      ]);
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: restaurantId, action: "employee.shift.force_ended",
        entity_type: "employee_shift", entity_id: row.id, request_id: requestId ?? null,
        metadata: { employeeId },
      }).execute();
      return toShift(row);
    });
  }
}
