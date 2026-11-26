import { managedImagePath } from "../../../common/tenancy/managed-image-path";
import { RUNTIME_CONFIG, type RuntimeConfig } from "../../../common/config/runtime-config";
import { Inject, BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { sql, type Selectable } from "kysely";
import type { AuthPrincipal } from "../../../common/auth/principal";
import { decodeDisplayCursor, encodeDisplayCursor } from "../../../common/pagination/keyset";
import { DatabaseService } from "../../../database/database.service";
import type { CategoriesTable } from "../../../database/database.types";
import type {
  CategoryDto, CreateCategoryDto, MenuPageDto, PatchCategoryDto,
} from "../presentation/menu.dto";
import { lockTenantForMenuWrite, requireOwnerBranch } from "./menu-access";

type CategoryRow = Selectable<CategoriesTable>;
export function categoryDto(row: CategoryRow, publicOrigin?: string): CategoryDto {
  return { id: row.id, branchId: row.branch_id, name: row.name, description: row.description,
    imageMediaId: row.image_media_id, imageUrl: row.image_url,
    imagePath: row.image_media_id && row.image_url ? managedImagePath(row.image_url, row.restaurant_id, publicOrigin, row.image_media_id) : null,
    sortOrder: row.sort_order, isActive: row.is_active, createdAt: row.created_at.toISOString() };
}

function uniqueCategoryConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505" &&
    "constraint" in error && error.constraint === "categories_live_name_ci_unique";
}

@Injectable()
export class CategoriesService {
  constructor(private readonly database: DatabaseService, @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  private async resolveImage(db: DatabaseService["db"], restaurantId: string, id: string | null) {
    if (id === null) return { image_media_id: null, image_url: null };
    const asset = await db.selectFrom("media_assets").select(["id", "public_url"])
      .where("id", "=", id).where("restaurant_id", "=", restaurantId)
      .where("kind", "=", "image").where("status", "=", "ready").forUpdate().executeTakeFirst();
    if (!asset?.public_url) throw new NotFoundException("Media asset not found");
    return { image_media_id: asset.id, image_url: asset.public_url };
  }

  async list(principal: AuthPrincipal, branchId: string, query: MenuPageDto) {
    await requireOwnerBranch(this.database.db, principal, branchId);
    let select = this.database.db.selectFrom("categories").selectAll()
      .where("branch_id", "=", branchId).where("archived_at", "is", null);
    if (query.search) {
      select = select.where(sql<boolean>`position(lower(${query.search}) in lower(name)) > 0`);
    }
    if (query.cursor) {
      const cursor = decodeDisplayCursor(query.cursor);
      select = select.where(sql<boolean>`(sort_order,id) > (${cursor.sortOrder}::int,${cursor.id}::uuid)`);
    }
    const rows = await select.orderBy("sort_order", "asc").orderBy("id", "asc")
      .limit(query.limit + 1).execute();
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return { data: page.map(row => categoryDto(row, this.config.mediaStorage?.publicOrigin)), meta: { hasMore,
      nextCursor: hasMore && last ? encodeDisplayCursor({ sortOrder: last.sort_order, id: last.id }) : null } };
  }

  async get(principal: AuthPrincipal, branchId: string, id: string): Promise<CategoryDto> {
    await requireOwnerBranch(this.database.db, principal, branchId);
    const row = await this.database.db.selectFrom("categories").selectAll()
      .where("id", "=", id).where("branch_id", "=", branchId)
      .where("archived_at", "is", null).executeTakeFirst();
    if (!row) throw new NotFoundException("Category not found");
    return categoryDto(row, this.config.mediaStorage?.publicOrigin);
  }

  async create(principal: AuthPrincipal, branchId: string,
    input: CreateCategoryDto, requestId?: string): Promise<CategoryDto> {
    try {
      return await this.database.db.transaction().execute(async (trx) => {
        await lockTenantForMenuWrite(trx, principal);
        const branch = await requireOwnerBranch(trx, principal, branchId);
        const row = await trx.insertInto("categories").values({
          restaurant_id: branch.restaurant_id, branch_id: branchId, name: input.name.trim(),
          description: input.description ?? null, sort_order: input.sortOrder ?? 0,
          is_active: input.isActive ?? true, archived_at: null,
          ...await this.resolveImage(trx, branch.restaurant_id, input.imageMediaId ?? null),
        }).returningAll().executeTakeFirstOrThrow();
        await trx.insertInto("audit_logs").values({
          actor_user_id: principal.id, restaurant_id: branch.restaurant_id,
          action: "menu.category.created", entity_type: "category", entity_id: row.id,
          request_id: requestId ?? null, metadata: { branchId },
        }).execute();
        return categoryDto(row, this.config.mediaStorage?.publicOrigin);
      });
    } catch (error: unknown) {
      if (uniqueCategoryConflict(error)) throw new ConflictException({ code: "CATEGORY_NAME_TAKEN", message: "Category name already exists in branch" });
      throw error;
    }
  }

  async patch(principal: AuthPrincipal, branchId: string, id: string,
    input: PatchCategoryDto, requestId?: string): Promise<CategoryDto> {
    if (!Object.keys(input).length) throw new BadRequestException("At least one category field required");
    try {
      return await this.database.db.transaction().execute(async (trx) => {
        await lockTenantForMenuWrite(trx, principal);
        const branch = await requireOwnerBranch(trx, principal, branchId);
        const previous = await trx.selectFrom("categories").select("id")
          .where("id", "=", id).where("branch_id", "=", branchId).where("archived_at", "is", null)
          .forUpdate().executeTakeFirst();
        if (!previous) throw new NotFoundException("Category not found");
        const patch: { name?: string; description?: string | null; sort_order?: number; is_active?: boolean; image_media_id?: string | null; image_url?: string | null } = {};
        if (input.name !== undefined) patch.name = input.name.trim();
        if (input.description !== undefined) patch.description = input.description;
        if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
        if (input.isActive !== undefined) patch.is_active = input.isActive;
        if (input.imageMediaId !== undefined) Object.assign(patch, await this.resolveImage(trx, branch.restaurant_id, input.imageMediaId));
        const row = await trx.updateTable("categories").set(patch)
          .where("id", "=", id).returningAll().executeTakeFirstOrThrow();
        await trx.insertInto("audit_logs").values({
          actor_user_id: principal.id, restaurant_id: branch.restaurant_id,
          action: "menu.category.updated", entity_type: "category", entity_id: id,
          request_id: requestId ?? null, metadata: { branchId, fields: Object.keys(patch).sort() },
        }).execute();
        return categoryDto(row, this.config.mediaStorage?.publicOrigin);
      });
    } catch (error: unknown) {
      if (uniqueCategoryConflict(error)) throw new ConflictException({ code: "CATEGORY_NAME_TAKEN", message: "Category name already exists in branch" });
      throw error;
    }
  }

  async archive(principal: AuthPrincipal, branchId: string, id: string, requestId?: string): Promise<void> {
    await this.database.db.transaction().execute(async (trx) => {
      await lockTenantForMenuWrite(trx, principal);
      const branch = await requireOwnerBranch(trx, principal, branchId);
      const row = await trx.updateTable("categories").set({ archived_at: new Date(), is_active: false })
        .where("id", "=", id).where("branch_id", "=", branchId)
        .where("archived_at", "is", null).returning("id").executeTakeFirst();
      if (!row) throw new NotFoundException("Category not found");
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: branch.restaurant_id,
        action: "menu.category.archived", entity_type: "category", entity_id: id,
        request_id: requestId ?? null, metadata: { branchId },
      }).execute();
    });
  }
}
