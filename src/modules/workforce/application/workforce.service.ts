import {
  ConflictException, ForbiddenException, Injectable, NotFoundException,
} from "@nestjs/common";
import { sql, type Selectable } from "kysely";
import type { AuthPrincipal } from "../../../common/auth/principal";
import { hashPassword } from "../../../common/crypto/password";
import { requireOperationalEntitlements } from "../../../common/subscription/operational-entitlement";
import { DatabaseService } from "../../../database/database.service";
import type { EmployeeShiftsTable } from "../../../database/database.types";
import type { CreateEmployeeDto, EmployeeDto, ShiftDto } from "../presentation/workforce.dto";

type ShiftRow = Selectable<EmployeeShiftsTable>;
function shiftDto(row: ShiftRow, now = new Date()): ShiftDto {
  return { id: row.id, employeeId: row.employee_user_id, branchId: row.branch_id,
    startedAt: row.started_at.toISOString(), plannedEndsAt: row.planned_ends_at.toISOString(),
    endedAt: row.ended_at?.toISOString() ?? null,
    isOnShift: row.ended_at === null && row.planned_ends_at > now };
}
function usernameCollision(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && error.code === "23505" && "constraint" in error && error.constraint === "users_username_ci_unique";
}

@Injectable()
export class WorkforceService {
  constructor(private readonly database: DatabaseService) {}

  async createEmployee(principal: AuthPrincipal, branchId: string, input: CreateEmployeeDto, requestId?: string): Promise<EmployeeDto> {
    if (!principal.restaurantId) throw new ForbiddenException("Restaurant scope required");
    // Hash credentials before acquiring the tenant lock to avoid holding it during scrypt.
    const passwordHash = await hashPassword(input.initialPassword);
    try {
      return await this.database.db.transaction().execute(async (trx) => {
        const restaurant = await trx.selectFrom("restaurants")
          .select("id").where("id", "=", principal.restaurantId)
          .forUpdate().executeTakeFirst();
        if (!restaurant) throw new NotFoundException("Restaurant not found");
        const branch = await trx.selectFrom("branches").select("id")
          .where("id", "=", branchId).where("restaurant_id", "=", principal.restaurantId)
          .where("is_active", "=", true).executeTakeFirst();
        if (!branch) throw new NotFoundException("Branch not found");
        const entitlements = await requireOperationalEntitlements(trx, principal.restaurantId);
        const count = await trx.selectFrom("users").select(sql<number>`count(*)::int`.as("count"))
          .where("restaurant_id", "=", principal.restaurantId)
          .where("role", "=", "EMPLOYEE").executeTakeFirstOrThrow();
        if (count.count >= entitlements.maxEmployees) {
          throw new ForbiddenException({ code: "PLAN_LIMIT_REACHED", message: "Employee limit reached" });
        }
        const row = await trx.insertInto("users").values({
          username: input.username, display_name: input.displayName.trim(), password_hash: passwordHash,
          role: "EMPLOYEE", restaurant_id: principal.restaurantId, branch_id: branchId,
          department: input.department, must_change_password: true, is_active: true,
        }).returning(["id","username","display_name","department","branch_id","is_active"]).executeTakeFirstOrThrow();
        await trx.insertInto("audit_logs").values({
          actor_user_id: principal.id, restaurant_id: principal.restaurantId,
          action: "employee.created", entity_type: "employee", entity_id: row.id,
          request_id: requestId ?? null, metadata: { branchId, department: input.department },
        }).execute();
        return { id: row.id, branchId, username: row.username, displayName: row.display_name,
          department: input.department, isActive: row.is_active };
      });
    } catch(error) {
      if (usernameCollision(error)) throw new ConflictException({
        code: "EMPLOYEE_USERNAME_TAKEN", message: "Username already exists",
      });
      throw error;
    }
  }

  async listEmployees(principal: AuthPrincipal, branchId: string): Promise<EmployeeDto[]> {
    if (!principal.restaurantId) throw new ForbiddenException("Restaurant scope required");
    await requireOperationalEntitlements(this.database.db, principal.restaurantId);
    const branch = await this.database.db.selectFrom("branches").select("id")
      .where("id", "=", branchId).where("restaurant_id", "=", principal.restaurantId)
      .where("is_active", "=", true).executeTakeFirst();
    if (!branch) throw new NotFoundException("Branch not found");
    const employees = await this.database.db.selectFrom("users")
      .select(["id","username","display_name","department","branch_id","is_active"])
      .where("branch_id", "=", branchId).where("role", "=", "EMPLOYEE")
      .orderBy("created_at", "desc").limit(100).execute();
    return employees.map((row) => ({ id: row.id, branchId, username: row.username,
      displayName: row.display_name, department: row.department ?? "waiter", isActive: row.is_active }));
  }

  async startShift(principal: AuthPrincipal): Promise<ShiftDto> {
    if (!principal.restaurantId || !principal.branchId) throw new ForbiddenException("Employee branch required");
    return this.database.db.transaction().execute(async (trx) => {
      const employee = await trx.selectFrom("users").select(["id","is_active","branch_id"])
        .where("id", "=", principal.id).where("role", "=", "EMPLOYEE")
        .forUpdate().executeTakeFirst();
      if (!employee?.is_active || employee.branch_id !== principal.branchId) {
        throw new ForbiddenException("Employee not active");
      }
      await requireOperationalEntitlements(trx, principal.restaurantId);
      const branch = await trx.selectFrom("branches").select("id")
        .where("id", "=", principal.branchId).where("is_active", "=", true).executeTakeFirst();
      if (!branch) throw new NotFoundException("Branch not found");
      const now = new Date();
      const existing = await trx.selectFrom("employee_shifts").selectAll()
        .where("employee_user_id", "=", principal.id).where("ended_at", "is", null)
        .forUpdate().executeTakeFirst();
      if (existing?.planned_ends_at && existing.planned_ends_at > now) {
        throw new ConflictException({ code: "SHIFT_ALREADY_ACTIVE", message: "Shift already active" });
      }
      if (existing) await trx.updateTable("employee_shifts")
        .set({ ended_at: existing.planned_ends_at }).where("id", "=", existing.id).execute();
      const settings = await trx.selectFrom("branch_call_settings").select("shift_max_minutes")
        .where("branch_id", "=", principal.branchId).executeTakeFirst();
      const minutes = settings?.shift_max_minutes ?? 720;
      const row = await trx.insertInto("employee_shifts").values({
        employee_user_id: principal.id, restaurant_id: principal.restaurantId,
        branch_id: principal.branchId,
        started_at: now, planned_ends_at: new Date(now.getTime() + minutes * 60_000),
        ended_at: null, ended_by_user_id: null,
      }).returningAll().executeTakeFirstOrThrow();
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: principal.restaurantId,
        action: "employee.shift.started", entity_type: "employee_shift", entity_id: row.id,
        metadata: { branchId: principal.branchId },
        request_id: null,
      }).execute();
      return shiftDto(row, now);
    });
  }

  async currentShift(principal: AuthPrincipal): Promise<ShiftDto | null> {
    const row = await this.database.db.selectFrom("employee_shifts").selectAll()
      .where("employee_user_id", "=", principal.id)
      .orderBy("started_at", "desc").limit(1).executeTakeFirst();
    return row ? shiftDto(row) : null;
  }

  async endShift(principal: AuthPrincipal, shiftId?: string): Promise<ShiftDto> {
    if (!principal.restaurantId) throw new ForbiddenException("Restaurant scope required");
    return this.database.db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom("employee_shifts").selectAll()
        .where("employee_user_id", "=", principal.id).where("ended_at", "is", null)
        .forUpdate().executeTakeFirst();
      if (!current || (shiftId && current.id !== shiftId)) {
        throw new NotFoundException("No open shift");
      }
      const now = new Date();
      const endedAt = current.planned_ends_at < now ? current.planned_ends_at : now;
      const row = await trx.updateTable("employee_shifts").set({
        ended_at: endedAt, ended_by_user_id: principal.id,
      }).where("id", "=", current.id).returningAll().executeTakeFirstOrThrow();
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: principal.restaurantId,
        action: "employee.shift.ended", entity_type: "employee_shift", entity_id: row.id,
        metadata: { branchId: row.branch_id }, request_id: null,
      }).execute();
      return shiftDto(row);
    });
  }

  async forceEnd(principal: AuthPrincipal, shiftId: string, requestId?: string): Promise<ShiftDto> {
    if (!principal.restaurantId) throw new ForbiddenException("Restaurant scope required");
    return this.database.db.transaction().execute(async (trx) => {
      const row = await trx.selectFrom("employee_shifts").selectAll()
        .where("id", "=", shiftId).where("restaurant_id", "=", principal.restaurantId)
        .forUpdate().executeTakeFirst();
      if (!row) throw new NotFoundException("Shift not found");
      if (row.ended_at) return shiftDto(row);
      const now = new Date();
      const updated = await trx.updateTable("employee_shifts")
        .set({ ended_at: now < row.planned_ends_at ? now : row.planned_ends_at,
          ended_by_user_id: principal.id })
        .where("id", "=", shiftId).returningAll().executeTakeFirstOrThrow();
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: principal.restaurantId,
        action: "employee.shift.force_ended", entity_type: "employee_shift", entity_id: row.id,
        metadata: { branchId: row.branch_id }, request_id: requestId ?? null,
      }).execute();
      return shiftDto(updated);
    });
  }
}
