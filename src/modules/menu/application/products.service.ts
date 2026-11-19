import {
  BadRequestException, ConflictException, Injectable, Inject, NotFoundException,
} from "@nestjs/common";
import { sql, type Selectable } from "kysely";
import { DatabaseService } from "../../../database/database.service";
import type { ProductsTable } from "../../../database/database.types";
import type { AuthPrincipal } from "../../../common/auth/principal";
import { decodeDisplayCursor, encodeDisplayCursor } from "../../../common/pagination/keyset";
import { RUNTIME_CONFIG, type RuntimeConfig } from "../../../common/config/runtime-config";
import type {
  CreateProductDto, MenuPageDto, PatchProductDto, ProductDto, ProductImageDto, ProductImageInputDto,
} from "../presentation/menu.dto";
import { lockTenantForMenuWrite, requireOwnerBranch } from "./menu-access";
import { verifyMediaUrls } from "./menu-media.policy";

type ProductRow = Selectable<ProductsTable>;

export function productDto(row: ProductRow, images: ProductImageDto[]): ProductDto {
  return {
    id: row.id, branchId: row.branch_id, categoryId: row.category_id, name: row.name,
    description: row.description, priceMinor: row.price_minor, oldPriceMinor: row.old_price_minor,
    currency: row.currency, tags: row.tags, isVisible: row.is_visible, isSoldOut: row.is_sold_out,
    sortOrder: row.sort_order, images, createdAt: row.created_at.toISOString(),
  };
}

export async function imagesForProducts(db: DatabaseService["db"], ids: string[]): Promise<Map<string, ProductImageDto[]>> {
  const byId = new Map<string, ProductImageDto[]>();
  if (!ids.length) return byId;
  const images = await db.selectFrom("product_images")
    .select(["id", "product_id", "url", "alt", "sort_order", "media_asset_id"])
    .where("product_id", "in", ids).orderBy("sort_order", "asc").execute();
  for (const image of images) {
    const existing = byId.get(image.product_id) ?? [];
    existing.push({ id: image.id, url: image.url, alt: image.alt, sortOrder: image.sort_order, ...(image.media_asset_id ? { mediaId: image.media_asset_id } : {}) });
    byId.set(image.product_id, existing);
  }
  return byId;
}

function assertPrices(priceMinor: number, oldPriceMinor: number | null): void {
  if (oldPriceMinor !== null && oldPriceMinor <= priceMinor) {
    throw new BadRequestException({ code: "INVALID_OLD_PRICE", message: "Old price must exceed current price" });
  }
}

@Injectable()
export class ProductsService {
  constructor(private readonly database: DatabaseService, @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  private async imageList(productId: string): Promise<ProductImageDto[]> {
    const images = await imagesForProducts(this.database.db, [productId]);
    return images.get(productId) ?? [];
  }

  private async assertCategory(db: DatabaseService["db"], branchId: string, categoryId: string): Promise<void> {
    const row = await db.selectFrom("categories").select("id")
      .where("id", "=", categoryId).where("branch_id", "=", branchId)
      .where("is_active", "=", true).where("archived_at", "is", null).executeTakeFirst();
    if (!row) throw new NotFoundException("Category not found");
  }

  async list(principal: AuthPrincipal, branchId: string, query: MenuPageDto) {
    await requireOwnerBranch(this.database.db, principal, branchId);
    let select = this.database.db.selectFrom("products").selectAll()
      .where("branch_id", "=", branchId).where("archived_at", "is", null);
    if (query.search) select = select.where(sql<boolean>`position(lower(${query.search}) in lower(name)) > 0`);
    if (query.cursor) {
      const cursor = decodeDisplayCursor(query.cursor);
      select = select.where(sql<boolean>`(sort_order,id) > (${cursor.sortOrder}::int,${cursor.id}::uuid)`);
    }
    const result = await select.orderBy("sort_order", "asc").orderBy("id", "asc")
      .limit(query.limit + 1).execute();
    const hasMore = result.length > query.limit;
    const page = result.slice(0, query.limit);
    const images = await imagesForProducts(this.database.db, page.map((p) => p.id));
    const last = page.at(-1);
    return { data: page.map((p) => productDto(p, images.get(p.id) ?? [])),
      meta: { hasMore, nextCursor: hasMore && last
        ? encodeDisplayCursor({ sortOrder: last.sort_order, id: last.id }) : null } };
  }

  async get(principal: AuthPrincipal, branchId: string, productId: string): Promise<ProductDto> {
    await requireOwnerBranch(this.database.db, principal, branchId);
    const row = await this.database.db.selectFrom("products").selectAll()
      .where("id", "=", productId).where("branch_id", "=", branchId)
      .where("archived_at", "is", null).executeTakeFirst();
    if (!row) throw new NotFoundException("Product not found");
    return productDto(row, await this.imageList(row.id));
  }

  async create(principal: AuthPrincipal, branchId: string, input: CreateProductDto,
    requestId?: string): Promise<ProductDto> {
    assertPrices(input.priceMinor, input.oldPriceMinor ?? null);
    verifyMediaUrls(input.images ?? [], this.config.mediaAllowedOrigins);
    const row = await this.database.db.transaction().execute(async (trx) => {
      await lockTenantForMenuWrite(trx, principal);
      const branch = await requireOwnerBranch(trx, principal, branchId);
      if (!branch.currency) throw new ConflictException({ code: "BRANCH_CURRENCY_REQUIRED", message: "Configure branch currency before creating priced products" });
      await this.assertCategory(trx, branchId, input.categoryId);
      const created = await trx.insertInto("products").values({
        restaurant_id: branch.restaurant_id, branch_id: branchId, category_id: input.categoryId,
        name: input.name.trim(), description: input.description ?? null, price_minor: input.priceMinor,
        old_price_minor: input.oldPriceMinor ?? null, currency: branch.currency, tags: input.tags ?? [],
        is_visible: input.isVisible ?? true, is_sold_out: input.isSoldOut ?? false,
        sort_order: input.sortOrder ?? 0, archived_at: null,
      }).returningAll().executeTakeFirstOrThrow();
      await this.replaceImages(trx, created.id, branchId, branch.restaurant_id, input.images ?? []);
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: branch.restaurant_id,
        action: "menu.product.created", entity_type: "product", entity_id: created.id,
        request_id: requestId ?? null, metadata: { branchId, categoryId: input.categoryId },
      }).execute();
      return created;
    });
    return productDto(row, await this.imageList(row.id));
  }

  async patch(principal: AuthPrincipal, branchId: string, productId: string,
    input: PatchProductDto, requestId?: string): Promise<ProductDto> {
    if (!Object.keys(input).length) throw new BadRequestException("At least one product field required");
    if (input.images) verifyMediaUrls(input.images, this.config.mediaAllowedOrigins);
    const row = await this.database.db.transaction().execute(async (trx) => {
      await lockTenantForMenuWrite(trx, principal);
      const branch = await requireOwnerBranch(trx, principal, branchId);
      const existing = await trx.selectFrom("products").selectAll()
        .where("id", "=", productId).where("branch_id", "=", branchId)
        .where("archived_at", "is", null).forUpdate().executeTakeFirst();
      if (!existing) throw new NotFoundException("Product not found");
      const priceMinor = input.priceMinor ?? existing.price_minor;
      const oldPriceMinor = input.oldPriceMinor === undefined ? existing.old_price_minor : input.oldPriceMinor;
      assertPrices(priceMinor, oldPriceMinor);
      if (input.categoryId) await this.assertCategory(trx, branchId, input.categoryId);
      const patch: {
        category_id?: string; name?: string; description?: string | null;
        price_minor?: number; old_price_minor?: number | null; tags?: string[];
        is_visible?: boolean; is_sold_out?: boolean; sort_order?: number;
      } = {};
      if (input.categoryId !== undefined) patch.category_id = input.categoryId;
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.description !== undefined) patch.description = input.description;
      if (input.priceMinor !== undefined) patch.price_minor = input.priceMinor;
      if (input.oldPriceMinor !== undefined) patch.old_price_minor = input.oldPriceMinor;
      if (input.tags !== undefined) patch.tags = input.tags;
      if (input.isVisible !== undefined) patch.is_visible = input.isVisible;
      if (input.isSoldOut !== undefined) patch.is_sold_out = input.isSoldOut;
      if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
      const updated = Object.keys(patch).length ? await trx.updateTable("products").set(patch)
        .where("id", "=", productId).returningAll().executeTakeFirstOrThrow() : existing;
      if (input.images !== undefined) await this.replaceImages(trx, productId, branchId, branch.restaurant_id, input.images);
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: branch.restaurant_id,
        action: "menu.product.updated", entity_type: "product", entity_id: productId,
        request_id: requestId ?? null,
        metadata: { branchId, fields: Object.keys(input).sort() },
      }).execute();
      return updated;
    });
    return productDto(row, await this.imageList(row.id));
  }

  async archive(principal: AuthPrincipal, branchId: string, productId: string, requestId?: string): Promise<void> {
    await this.database.db.transaction().execute(async (trx) => {
      await lockTenantForMenuWrite(trx, principal);
      const branch = await requireOwnerBranch(trx, principal, branchId);
      const result = await trx.updateTable("products")
        .set({ archived_at: new Date(), is_visible: false })
        .where("id", "=", productId).where("branch_id", "=", branchId)
        .where("archived_at", "is", null).returning("id").executeTakeFirst();
      if (!result) throw new NotFoundException("Product not found");
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: branch.restaurant_id,
        action: "menu.product.archived", entity_type: "product", entity_id: productId,
        request_id: requestId ?? null, metadata: { branchId },
      }).execute();
    });
  }

  private async replaceImages(db: DatabaseService["db"], productId: string, branchId: string, restaurantId: string,
    images: readonly ProductImageInputDto[]): Promise<void> {
    await db.deleteFrom("product_images").where("product_id", "=", productId).execute();
    for (const [sortOrder, image] of images.entries()) {
      await db.insertInto("product_images").values({
        product_id: productId, branch_id: branchId, restaurant_id: restaurantId, media_asset_id: null, url: image.url,
        alt: image.alt ?? null, sort_order: sortOrder,
      }).execute();
    }
  }
}
