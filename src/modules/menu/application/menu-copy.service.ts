import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { DatabaseService } from "../../../database/database.service";
import type { AuthPrincipal } from "../../../common/auth/principal";
import type { CopyMenuDto, CopyMenuResultDto } from "../presentation/menu.dto";
import { lockTenantForMenuWrite, requireOwnerBranch } from "./menu-access";

@Injectable()
export class MenuCopyService {
  constructor(private readonly database: DatabaseService) {}

  async copy(principal: AuthPrincipal, targetBranchId: string, body: CopyMenuDto,
    requestId?: string): Promise<CopyMenuResultDto> {
    if (body.includeTemplate) throw new BadRequestException({ code: "TEMPLATE_COPY_NOT_AVAILABLE",
      message: "Table/floor templates are part of the future tables slice" });
    if (body.sourceBranchId === targetBranchId) {
      throw new BadRequestException("Source and destination branches must differ");
    }
    return this.database.db.transaction().execute(async (trx) => {
      await lockTenantForMenuWrite(trx, principal);
      const source = await requireOwnerBranch(trx, principal, body.sourceBranchId);
      const target = await requireOwnerBranch(trx, principal, targetBranchId);
      // Explicit non-destructive contract: only copy into an empty target to avoid accidental overwrite.
      const targetCategories = await trx.selectFrom("categories").select("id")
        .where("branch_id", "=", targetBranchId).where("archived_at", "is", null).limit(1).executeTakeFirst();
      const targetProducts = await trx.selectFrom("products").select("id")
        .where("branch_id", "=", targetBranchId).where("archived_at", "is", null).limit(1).executeTakeFirst();
      if (targetCategories || targetProducts) throw new ConflictException({
        code: "MENU_TARGET_NOT_EMPTY", message: "Target branch must have an empty menu",
      });

      const categories = await trx.selectFrom("categories").selectAll()
        .where("branch_id", "=", source.id).where("archived_at", "is", null)
        .orderBy("sort_order", "asc").orderBy("id", "asc").limit(501).execute();
      if (categories.length > 500) throw new BadRequestException("Source menu exceeds supported copy size");
      const products = await trx.selectFrom("products").selectAll()
        .where("branch_id", "=", source.id).where("archived_at", "is", null)
        .orderBy("sort_order", "asc").orderBy("id", "asc").limit(2001).execute();
      if (products.length > 2000) throw new BadRequestException("Source menu exceeds supported copy size");
      const fromCategoryIds = new Set(categories.map((category) => category.id));
      if (products.some((product) => !fromCategoryIds.has(product.category_id))) {
        throw new ConflictException({ code: "MENU_SOURCE_ARCHIVED_CATEGORY",
          message: "Cannot copy a product whose category was archived" });
      }
      if (source.currency !== target.currency && target.currency && products.length > 0) {
        throw new ConflictException({ code: "MENU_CURRENCY_MISMATCH",
          message: "Source and target branch currencies must match" });
      }
      if (!target.currency && source.currency) {
        await trx.updateTable("branches").set({ currency: source.currency })
          .where("id", "=", targetBranchId).execute();
      }

      const categoryMap = new Map<string, string>();
      for (const category of categories) {
        const created = await trx.insertInto("categories").values({
          restaurant_id: target.restaurant_id, branch_id: targetBranchId,
          name: category.name, description: category.description,
          sort_order: category.sort_order, is_active: category.is_active, archived_at: null,
        }).returning("id").executeTakeFirstOrThrow();
        categoryMap.set(category.id, created.id);
      }
      for (const product of products) {
        const targetCategory = categoryMap.get(product.category_id);
        if (!targetCategory) throw new ConflictException("Category mapping missing");
        const created = await trx.insertInto("products").values({
          restaurant_id: target.restaurant_id, branch_id: targetBranchId,
          category_id: targetCategory, name: product.name, description: product.description,
          price_minor: product.price_minor, old_price_minor: product.old_price_minor,
          currency: product.currency, tags: [...product.tags],
          is_visible: product.is_visible, is_sold_out: product.is_sold_out,
          sort_order: product.sort_order, archived_at: null,
        }).returning("id").executeTakeFirstOrThrow();
        const images = await trx.selectFrom("product_images").select(["url", "alt", "sort_order"])
          .where("product_id", "=", product.id).orderBy("sort_order", "asc").execute();
        if (images.length) await trx.insertInto("product_images")
          .values(images.map((image) => ({
            product_id: created.id, branch_id: targetBranchId, url: image.url,
            alt: image.alt, sort_order: image.sort_order,
          }))).execute();
      }
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: source.restaurant_id,
        action: "menu.copied", entity_type: "branch", entity_id: targetBranchId,
        request_id: requestId ?? null, metadata: {
          sourceBranchId: source.id, categoriesCopied: categories.length, productsCopied: products.length,
        },
      }).execute();
      return { categoriesCopied: categories.length, productsCopied: products.length };
    });
  }
}
