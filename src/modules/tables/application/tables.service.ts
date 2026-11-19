import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Inject, NotFoundException,
} from "@nestjs/common";
import { sql, type Selectable } from "kysely";
import { RUNTIME_CONFIG, type RuntimeConfig } from "../../../common/config/runtime-config";
import type { AuthPrincipal } from "../../../common/auth/principal";
import { decodeDisplayCursor, encodeDisplayCursor } from "../../../common/pagination/keyset";
import { DatabaseService } from "../../../database/database.service";
import type { RestaurantTablesTable } from "../../../database/database.types";
import { encryptQrToken, generateQrToken, hashQrToken } from "../domain/qr-credential";
import type {
  CreateTableDto, CreateTablesBulkDto, PatchTableDto, RestaurantTableDto, TableListQueryDto,
} from "../presentation/tables.dto";
import { lockRestaurant, ownerBranch, requireQrConfig } from "./table-access";
import type { TablesDb } from "./table-access";

type Row = Selectable<RestaurantTablesTable>;
export const toTableDto = (row: Row): RestaurantTableDto => ({
  id: row.id, branchId: row.branch_id, areaId: row.area_id, label: row.label,
  sortOrder: row.sort_order, isActive: row.is_active, qrEnabled: row.qr_enabled,
  callsEnabled: row.calls_enabled, qrVersion: row.qr_version,
});

function labelConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && error.code === "23505" && "constraint" in error
    && error.constraint === "restaurant_tables_label_ci_unique";
}

@Injectable()
export class TablesService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  private async requireArea(db: TablesDb, branchId: string, areaId: string): Promise<void> {
    const area = await db.selectFrom("areas")
      .innerJoin("floors", (join) => join.onRef("floors.id", "=", "areas.floor_id")
        .onRef("floors.branch_id", "=", "areas.branch_id"))
      .select("areas.id")
      .where("areas.id", "=", areaId).where("areas.branch_id", "=", branchId)
      .where("areas.archived_at", "is", null).where("areas.is_active", "=", true)
      .where("floors.archived_at", "is", null).where("floors.is_active", "=", true)
      .executeTakeFirst();
    if (!area) throw new NotFoundException("Area not found");
  }

  async list(principal: AuthPrincipal, branchId: string, query: TableListQueryDto) {
    await ownerBranch(this.database.db, principal, branchId);
    let qb = this.database.db.selectFrom("restaurant_tables")
      .selectAll().where("branch_id", "=", branchId).where("archived_at", "is", null);
    if (query.cursor) {
      const cursor = decodeDisplayCursor(query.cursor);
      qb = qb.where(sql<boolean>`(sort_order,id) > (${cursor.sortOrder}::int,${cursor.id}::uuid)`);
    }
    const rows = await qb.orderBy("sort_order", "asc").orderBy("id", "asc")
      .limit(query.limit + 1).execute();
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return { data: page.map(toTableDto), meta: {
      hasMore, nextCursor: hasMore && last
        ? encodeDisplayCursor({ sortOrder: last.sort_order, id: last.id }) : null,
    } };
  }

  async get(principal: AuthPrincipal, branchId: string, id: string): Promise<RestaurantTableDto> {
    await ownerBranch(this.database.db, principal, branchId);
    const row = await this.database.db.selectFrom("restaurant_tables").selectAll()
      .where("id", "=", id).where("branch_id", "=", branchId)
      .where("archived_at", "is", null).executeTakeFirst();
    if (!row) throw new NotFoundException("Table not found");
    return toTableDto(row);
  }

  async create(principal: AuthPrincipal, branchId: string,
    input: CreateTableDto, requestId?: string): Promise<RestaurantTableDto> {
    const created = await this.createMany(principal, branchId, [input.label], input.areaId,
      requestId, [input.sortOrder ?? 0]);
    return created[0];
  }

  async bulkCreate(principal: AuthPrincipal, branchId: string,
    input: CreateTablesBulkDto, requestId?: string): Promise<RestaurantTableDto[]> {
    return this.createMany(principal, branchId, input.labels, input.areaId, requestId);
  }

  private async createMany(principal: AuthPrincipal, branchId: string, labels: string[],
    areaId: string, requestId?: string, orders?: number[]): Promise<RestaurantTableDto[]> {
    const { key } = requireQrConfig(this.config);
    const prepared = labels.map((label) => label.trim());
    if (new Set(prepared.map((label) => label.toLocaleLowerCase("und"))).size !== prepared.length) {
      throw new BadRequestException({ code: "DUPLICATE_TABLE_LABELS", message: "Duplicate table labels in request" });
    }
    try {
      return await this.database.db.transaction().execute(async (trx) => {
        await lockRestaurant(trx, principal);
        const { branch, entitlements } = await ownerBranch(trx, principal, branchId);
        if (!entitlements.features.menu) throw new ForbiddenException({
          code: "PLAN_FEATURE_DISABLED", message: "Menu feature is unavailable",
        });
        await this.requireArea(trx, branchId, areaId);
        const used = await trx.selectFrom("restaurant_tables")
          .select(sql<number>`count(*)::int`.as("count"))
          .where("restaurant_id", "=", branch.restaurant_id)
          .where("archived_at", "is", null).executeTakeFirstOrThrow();
        if (used.count + prepared.length > entitlements.maxTables) throw new ForbiddenException({
          code: "PLAN_LIMIT_REACHED", message: "Maximum restaurant tables for plan reached",
        });
        const result: RestaurantTableDto[] = [];
        for (const [i, label] of prepared.entries()) {
          const row = await trx.insertInto("restaurant_tables").values({
            restaurant_id: branch.restaurant_id, branch_id: branchId, area_id: areaId,
            label, sort_order: orders?.[i] ?? i, archived_at: null,
          }).returningAll().executeTakeFirstOrThrow();
          const token = generateQrToken();
          await trx.insertInto("qr_credentials").values({
            table_id: row.id, branch_id: branchId, version: 1,
            token_hash: hashQrToken(token), token_box: encryptQrToken(token, key), revoked_at: null,
          }).execute();
          result.push(toTableDto(row));
        }
        await trx.insertInto("audit_logs").values({
          actor_user_id: principal.id, restaurant_id: branch.restaurant_id,
          action: "table.created", entity_type: "branch", entity_id: branchId,
          request_id: requestId ?? null, metadata: { branchId, created: result.length },
        }).execute();
        return result;
      });
    } catch (error) {
      if (labelConflict(error)) throw new ConflictException({
        code: "TABLE_LABEL_TAKEN", message: "A table with this label already exists in branch",
      });
      throw error;
    }
  }

  async patch(principal: AuthPrincipal, branchId: string, id: string,
    input: PatchTableDto, requestId?: string): Promise<RestaurantTableDto> {
    if (!Object.keys(input).length) throw new BadRequestException("At least one table field required");
    try {
      return await this.database.db.transaction().execute(async (trx) => {
        await lockRestaurant(trx, principal);
        const { branch } = await ownerBranch(trx, principal, branchId);
        const existing = await trx.selectFrom("restaurant_tables").selectAll()
          .where("id", "=", id).where("branch_id", "=", branchId)
          .where("archived_at", "is", null).forUpdate().executeTakeFirst();
        if (!existing) throw new NotFoundException("Table not found");
        if (input.areaId) await this.requireArea(trx, branchId, input.areaId);
        const patch: {
          area_id?: string; label?: string; sort_order?: number; is_active?: boolean;
          qr_enabled?: boolean; calls_enabled?: boolean;
        } = {};
        if (input.areaId !== undefined) patch.area_id = input.areaId;
        if (input.label !== undefined) patch.label = input.label.trim();
        if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
        if (input.isActive !== undefined) patch.is_active = input.isActive;
        if (input.qrEnabled !== undefined) patch.qr_enabled = input.qrEnabled;
        if (input.callsEnabled !== undefined) patch.calls_enabled = input.callsEnabled;
        const row = await trx.updateTable("restaurant_tables").set(patch)
          .where("id", "=", id).returningAll().executeTakeFirstOrThrow();
        await trx.insertInto("audit_logs").values({
          actor_user_id: principal.id, restaurant_id: branch.restaurant_id,
          action: "table.updated", entity_type: "table", entity_id: id,
          request_id: requestId ?? null,
          metadata: { branchId, fields: Object.keys(patch).sort() },
        }).execute();
        return toTableDto(row);
      });
    } catch (error) {
      if (labelConflict(error)) throw new ConflictException({
        code: "TABLE_LABEL_TAKEN", message: "A table with this label already exists in branch",
      });
      throw error;
    }
  }

  async archive(principal: AuthPrincipal, branchId: string, id: string, requestId?: string) {
    await this.database.db.transaction().execute(async (trx) => {
      await lockRestaurant(trx, principal);
      const { branch } = await ownerBranch(trx, principal, branchId);
      const row = await trx.updateTable("restaurant_tables")
        .set({ archived_at: new Date(), is_active: false, qr_enabled: false, calls_enabled: false })
        .where("id", "=", id).where("branch_id", "=", branchId)
        .where("archived_at", "is", null).returning("id").executeTakeFirst();
      if (!row) throw new NotFoundException("Table not found");
      await trx.updateTable("qr_credentials").set({ revoked_at: new Date() })
        .where("table_id", "=", id).where("revoked_at", "is", null).execute();
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: branch.restaurant_id,
        action: "table.archived", entity_type: "table", entity_id: id,
        request_id: requestId ?? null, metadata: { branchId },
      }).execute();
    });
    return { archived: true };
  }
}
