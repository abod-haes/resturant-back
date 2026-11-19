import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { sql, type RawBuilder } from "kysely";
import { DatabaseService } from "../../../database/database.service";
import type { PlanFeatures } from "../../../database/database.types";
import type { AuthPrincipal } from "../../../common/auth/principal";
import type { CreatePlanDto, ListPlansQueryDto, PatchPlanDto, PlanDto } from "../presentation/subscriptions.dto";

function parseCursor(encoded: string): { timestamp: string; id: string } {
  try {
    if (!/^[A-Za-z0-9_-]{1,500}$/.test(encoded)) throw new Error("Bad encoding");
    const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
      !("timestamp" in parsed) || !("id" in parsed) ||
      typeof parsed.timestamp !== "string" || typeof parsed.id !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(parsed.timestamp) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)) {
      throw new Error("Bad cursor");
    }
    return { timestamp: parsed.timestamp, id: parsed.id };
  } catch {
    throw new BadRequestException("Invalid pagination cursor");
  }
}

function isPlanNameConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    error.code === "23505" && "constraint" in error &&
    (error.constraint === "plans_name_key" || error.constraint === "plans_name_ci_unique");
}

type PlanRow = {
  id: string; name: string; max_branches: number; max_tables: number; max_employees: number;
  features: PlanFeatures; is_active: boolean; created_at: Date;
};

function serialize(row: PlanRow): PlanDto {
  return {
    id: row.id, name: row.name, maxBranches: row.max_branches,
    maxTables: row.max_tables, maxEmployees: row.max_employees,
    features: row.features, isActive: row.is_active, createdAt: row.created_at.toISOString(),
  };
}

@Injectable()
export class PlansService {
  constructor(private readonly database: DatabaseService) {}

  async create(input: CreatePlanDto, actor: AuthPrincipal, requestId?: string): Promise<PlanDto> {
    try {
      const created = await this.database.db.transaction().execute(async (trx) => {
        const plan = await trx.insertInto("plans").values({
          name: input.name.trim(),
          max_branches: input.maxBranches, max_tables: input.maxTables,
          max_employees: input.maxEmployees,
          features: input.features,
        }).returningAll().executeTakeFirstOrThrow();
        await trx.insertInto("audit_logs").values({
          actor_user_id: actor.id, restaurant_id: null, action: "plan.created",
          entity_type: "plan", entity_id: plan.id, request_id: requestId ?? null,
          metadata: { limits: { branches: plan.max_branches, tables: plan.max_tables, employees: plan.max_employees } },
        }).execute();
        return plan;
      });
      return serialize(created);
    } catch (error) {
      if (isPlanNameConflict(error)) throw new ConflictException({ code: "PLAN_NAME_TAKEN", message: "Plan name already exists" });
      throw error;
    }
  }

  async get(id: string): Promise<PlanDto> {
    const row = await this.database.db.selectFrom("plans").selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) throw new NotFoundException("Plan not found");
    return serialize(row);
  }

  async list(query: ListPlansQueryDto): Promise<{ data: PlanDto[]; meta: { nextCursor: string | null; hasMore: boolean } }> {
    let builder = this.database.db.selectFrom("plans").selectAll()
      .select(sql<string>`to_char(plans.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("cursor_timestamp"));
    if (query.cursor) {
      const { timestamp, id } = parseCursor(query.cursor);
      builder = builder.where(sql<boolean>`(plans.created_at, plans.id) < (${timestamp}::timestamptz, ${id}::uuid)`);
    }
    const rows = await builder.orderBy("created_at", "desc").orderBy("id", "desc")
      .limit(query.limit + 1).execute();
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor = hasMore && last
      ? Buffer.from(JSON.stringify({ timestamp: last.cursor_timestamp, id: last.id })).toString("base64url")
      : null;
    return { data: page.map(serialize), meta: { nextCursor, hasMore } };
  }

  async update(id: string, input: PatchPlanDto, actor: AuthPrincipal, requestId?: string): Promise<PlanDto> {
    const hasFields = Object.keys(input).length > 0;
    if (!hasFields || (input.features !== undefined && Object.keys(input.features).length === 0 && Object.keys(input).length === 1)) {
      throw new BadRequestException("At least one field is required");
    }
    try {
      await this.database.db.transaction().execute(async (trx) => {
        const existing = await trx.selectFrom("plans").selectAll()
          .where("id", "=", id).forUpdate().executeTakeFirst();
        if (!existing) throw new NotFoundException("Plan not found");
        const patch: {
          name?: string; max_branches?: number; max_tables?: number;
          max_employees?: number; features?: PlanFeatures | RawBuilder<PlanFeatures>; is_active?: boolean;
        } = {};
        if (input.name !== undefined) patch.name = input.name.trim();
        if (input.maxBranches !== undefined) patch.max_branches = input.maxBranches;
        if (input.maxTables !== undefined) patch.max_tables = input.maxTables;
        if (input.maxEmployees !== undefined) patch.max_employees = input.maxEmployees;
        // PostgreSQL JSONB patch preserves absent flags; never reset a subscribed feature by omission.
        if (input.features !== undefined) {
          patch.features = sql<PlanFeatures>`plans.features || ${JSON.stringify(input.features)}::jsonb`;
        }
        if (input.isActive !== undefined) patch.is_active = input.isActive;
        await trx.updateTable("plans").set(patch).where("id", "=", id).execute();
        await trx.insertInto("audit_logs").values({
          actor_user_id: actor.id, restaurant_id: null, action: "plan.updated",
          entity_type: "plan", entity_id: id, request_id: requestId ?? null,
          metadata: { fields: Object.keys(patch).sort() },
        }).execute();
      });
      return this.get(id);
    } catch (error) {
      if (isPlanNameConflict(error)) throw new ConflictException({ code: "PLAN_NAME_TAKEN", message: "Plan name already exists" });
      throw error;
    }
  }
}
