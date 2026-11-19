import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { sql, type Selectable } from "kysely";
import type { AuthPrincipal } from "../../../common/auth/principal";
import { decodeDisplayCursor, encodeDisplayCursor } from "../../../common/pagination/keyset";
import { DatabaseService } from "../../../database/database.service";
import type { AreasTable, FloorsTable } from "../../../database/database.types";
import type {
  AreaDto, CreateAreaDto, CreateFloorDto, FloorDto, PatchAreaDto, PatchFloorDto, TableListQueryDto,
} from "../presentation/tables.dto";
import { lockRestaurant, ownerBranch } from "./table-access";
import type { TablesDb } from "./table-access";

const floorDto = (row: Selectable<FloorsTable>): FloorDto => ({
  id: row.id, branchId: row.branch_id, name: row.name,
  sortOrder: row.sort_order, isActive: row.is_active,
});
const areaDto = (row: Selectable<AreasTable>): AreaDto => ({
  id: row.id, branchId: row.branch_id, floorId: row.floor_id, name: row.name,
  sortOrder: row.sort_order, isActive: row.is_active,
});
function conflictName(error: unknown, constraint: string): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && error.code === "23505" && "constraint" in error && error.constraint === constraint;
}
function page<T extends { id: string; sort_order: number }>(
  rows: T[], limit: number,
): { data: T[]; meta: { hasMore: boolean; nextCursor: string | null } } {
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  return { data, meta: { hasMore, nextCursor: hasMore && last
    ? encodeDisplayCursor({ sortOrder: last.sort_order, id: last.id }) : null } };
}

@Injectable()
export class FacilitiesService {
  constructor(private readonly database: DatabaseService) {}

  private async activeFloor(db: TablesDb, branchId: string, floorId: string): Promise<void> {
    const floor = await db.selectFrom("floors").select("id")
      .where("id", "=", floorId).where("branch_id", "=", branchId)
      .where("is_active", "=", true).where("archived_at", "is", null).executeTakeFirst();
    if (!floor) throw new NotFoundException("Floor not found");
  }

  async floors(principal: AuthPrincipal, branchId: string, query: TableListQueryDto) {
    await ownerBranch(this.database.db, principal, branchId);
    let request = this.database.db.selectFrom("floors").selectAll()
      .where("branch_id", "=", branchId).where("archived_at", "is", null);
    if (query.cursor) {
      const cursor = decodeDisplayCursor(query.cursor);
      request = request.where(sql<boolean>`(sort_order,id) > (${cursor.sortOrder}::int,${cursor.id}::uuid)`);
    }
    const rows = await request.orderBy("sort_order", "asc").orderBy("id", "asc")
      .limit(query.limit + 1).execute();
    const result = page(rows, query.limit);
    return { ...result, data: result.data.map(floorDto) };
  }

  async createFloor(principal: AuthPrincipal, branchId: string,
    input: CreateFloorDto, requestId?: string): Promise<FloorDto> {
    try {
      return await this.database.db.transaction().execute(async (trx) => {
        await lockRestaurant(trx, principal);
        const { branch } = await ownerBranch(trx, principal, branchId);
        const row = await trx.insertInto("floors").values({
          restaurant_id: branch.restaurant_id, branch_id: branchId, name: input.name.trim(),
          sort_order: input.sortOrder ?? 0, archived_at: null,
        }).returningAll().executeTakeFirstOrThrow();
        await trx.insertInto("audit_logs").values({
          actor_user_id: principal.id, restaurant_id: branch.restaurant_id, action: "floor.created",
          entity_type: "floor", entity_id: row.id, request_id: requestId ?? null,
          metadata: { branchId },
        }).execute();
        return floorDto(row);
      });
    } catch (error) {
      if (conflictName(error, "floors_live_name_ci_unique")) throw new ConflictException({
        code: "FLOOR_NAME_TAKEN", message: "Floor name already exists in branch",
      });
      throw error;
    }
  }

  async patchFloor(principal: AuthPrincipal, branchId: string, id: string,
    input: PatchFloorDto, requestId?: string): Promise<FloorDto> {
    if (!Object.keys(input).length) throw new BadRequestException("At least one floor field required");
    try {
      return await this.database.db.transaction().execute(async (trx) => {
        await lockRestaurant(trx, principal);
        const { branch } = await ownerBranch(trx, principal, branchId);
        const exists = await trx.selectFrom("floors").select("id")
          .where("id", "=", id).where("branch_id", "=", branchId)
          .where("archived_at", "is", null).forUpdate().executeTakeFirst();
        if (!exists) throw new NotFoundException("Floor not found");
        const patch: { name?: string; sort_order?: number; is_active?: boolean } = {};
        if (input.name !== undefined) patch.name = input.name.trim();
        if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
        if (input.isActive !== undefined) patch.is_active = input.isActive;
        const row = await trx.updateTable("floors").set(patch).where("id", "=", id)
          .returningAll().executeTakeFirstOrThrow();
        await trx.insertInto("audit_logs").values({
          actor_user_id: principal.id, restaurant_id: branch.restaurant_id, action: "floor.updated",
          entity_type: "floor", entity_id: id, request_id: requestId ?? null,
          metadata: { branchId, fields: Object.keys(patch).sort() },
        }).execute();
        return floorDto(row);
      });
    } catch (error) {
      if (conflictName(error, "floors_live_name_ci_unique")) throw new ConflictException({
        code: "FLOOR_NAME_TAKEN", message: "Floor name already exists in branch",
      });
      throw error;
    }
  }

  async archiveFloor(principal: AuthPrincipal, branchId: string, id: string, requestId?: string) {
    await this.database.db.transaction().execute(async (trx) => {
      await lockRestaurant(trx, principal);
      const { branch } = await ownerBranch(trx, principal, branchId);
      const activeChild = await trx.selectFrom("areas").select("id")
        .where("floor_id", "=", id).where("branch_id", "=", branchId)
        .where("archived_at", "is", null).limit(1).executeTakeFirst();
      if (activeChild) throw new ConflictException({ code: "FLOOR_NOT_EMPTY",
        message: "Archive areas before archiving their floor" });
      const row = await trx.updateTable("floors").set({ archived_at: new Date(), is_active: false })
        .where("id", "=", id).where("branch_id", "=", branchId)
        .where("archived_at", "is", null).returning("id").executeTakeFirst();
      if (!row) throw new NotFoundException("Floor not found");
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: branch.restaurant_id, action: "floor.archived",
        entity_type: "floor", entity_id: id, request_id: requestId ?? null, metadata: { branchId },
      }).execute();
    });
    return { archived: true };
  }

  async areas(principal: AuthPrincipal, branchId: string, query: TableListQueryDto) {
    await ownerBranch(this.database.db, principal, branchId);
    let request = this.database.db.selectFrom("areas").selectAll()
      .where("branch_id", "=", branchId).where("archived_at", "is", null);
    if (query.cursor) {
      const cursor = decodeDisplayCursor(query.cursor);
      request = request.where(sql<boolean>`(sort_order,id) > (${cursor.sortOrder}::int,${cursor.id}::uuid)`);
    }
    const rows = await request.orderBy("sort_order", "asc").orderBy("id", "asc")
      .limit(query.limit + 1).execute();
    const result = page(rows, query.limit);
    return { ...result, data: result.data.map(areaDto) };
  }

  async createArea(principal: AuthPrincipal, branchId: string,
    input: CreateAreaDto, requestId?: string): Promise<AreaDto> {
    try {
      return await this.database.db.transaction().execute(async (trx) => {
        await lockRestaurant(trx, principal);
        const { branch } = await ownerBranch(trx, principal, branchId);
        await this.activeFloor(trx, branchId, input.floorId);
        const row = await trx.insertInto("areas").values({
          restaurant_id: branch.restaurant_id, branch_id: branchId, floor_id: input.floorId,
          name: input.name.trim(), sort_order: input.sortOrder ?? 0, archived_at: null,
        }).returningAll().executeTakeFirstOrThrow();
        await trx.insertInto("audit_logs").values({
          actor_user_id: principal.id, restaurant_id: branch.restaurant_id, action: "area.created",
          entity_type: "area", entity_id: row.id, request_id: requestId ?? null, metadata: { branchId },
        }).execute();
        return areaDto(row);
      });
    } catch (error) {
      if (conflictName(error, "areas_live_name_ci_unique")) throw new ConflictException({
        code: "AREA_NAME_TAKEN", message: "Area name already exists on floor",
      });
      throw error;
    }
  }

  async patchArea(principal: AuthPrincipal, branchId: string, id: string,
    input: PatchAreaDto, requestId?: string): Promise<AreaDto> {
    if (!Object.keys(input).length) throw new BadRequestException("At least one area field required");
    try {
      return await this.database.db.transaction().execute(async (trx) => {
        await lockRestaurant(trx, principal);
        const { branch } = await ownerBranch(trx, principal, branchId);
        const existing = await trx.selectFrom("areas").select("id")
          .where("id", "=", id).where("branch_id", "=", branchId)
          .where("archived_at", "is", null).forUpdate().executeTakeFirst();
        if (!existing) throw new NotFoundException("Area not found");
        if (input.floorId) await this.activeFloor(trx, branchId, input.floorId);
        const patch: { floor_id?: string; name?: string; sort_order?: number; is_active?: boolean } = {};
        if (input.floorId !== undefined) patch.floor_id = input.floorId;
        if (input.name !== undefined) patch.name = input.name.trim();
        if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
        if (input.isActive !== undefined) patch.is_active = input.isActive;
        const row = await trx.updateTable("areas").set(patch).where("id", "=", id)
          .returningAll().executeTakeFirstOrThrow();
        await trx.insertInto("audit_logs").values({
          actor_user_id: principal.id, restaurant_id: branch.restaurant_id, action: "area.updated",
          entity_type: "area", entity_id: id, request_id: requestId ?? null,
          metadata: { branchId, fields: Object.keys(patch).sort() },
        }).execute();
        return areaDto(row);
      });
    } catch (error) {
      if (conflictName(error, "areas_live_name_ci_unique")) throw new ConflictException({
        code: "AREA_NAME_TAKEN", message: "Area name already exists on floor",
      });
      throw error;
    }
  }

  async archiveArea(principal: AuthPrincipal, branchId: string, id: string, requestId?: string) {
    await this.database.db.transaction().execute(async (trx) => {
      await lockRestaurant(trx, principal);
      const { branch } = await ownerBranch(trx, principal, branchId);
      const activeTable = await trx.selectFrom("restaurant_tables").select("id")
        .where("area_id", "=", id).where("branch_id", "=", branchId)
        .where("archived_at", "is", null).limit(1).executeTakeFirst();
      if (activeTable) throw new ConflictException({ code: "AREA_NOT_EMPTY",
        message: "Archive tables before archiving their area" });
      const row = await trx.updateTable("areas").set({ archived_at: new Date(), is_active: false })
        .where("id", "=", id).where("branch_id", "=", branchId)
        .where("archived_at", "is", null).returning("id").executeTakeFirst();
      if (!row) throw new NotFoundException("Area not found");
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: branch.restaurant_id, action: "area.archived",
        entity_type: "area", entity_id: id, request_id: requestId ?? null, metadata: { branchId },
      }).execute();
    });
    return { archived: true };
  }
}
