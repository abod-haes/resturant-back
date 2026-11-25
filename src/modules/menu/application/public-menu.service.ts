import { Injectable, NotFoundException } from "@nestjs/common";
import { sql } from "kysely";
import { DatabaseService } from "../../../database/database.service";
import { decodeDisplayCursor, encodeDisplayCursor } from "../../../common/pagination/keyset";
import { requireOperationalEntitlements } from "../../../common/subscription/operational-entitlement";
import type { CategoryDto, MenuPageDto, PublicMenuDto, PublicRestaurantDto } from "../presentation/menu.dto";
import { imagesForProducts, productDto } from "./products.service";

@Injectable()
export class PublicMenuService {
  constructor(private readonly database: DatabaseService) {}

  async restaurantBySubdomain(subdomain: string): Promise<PublicRestaurantDto> {
    const restaurant = await this.database.db.selectFrom("restaurants")
      .select(["id", "name", "subdomain"]).where("subdomain", "=", subdomain)
      .where("is_active", "=", true).where("domain_status", "=", "ready").executeTakeFirst();
    if (!restaurant || !restaurant.subdomain) throw new NotFoundException("Restaurant not found");
    await requireOperationalEntitlements(this.database.db, restaurant.id, "menu");
    const branches = await this.database.db.selectFrom("branches").select(["id", "name", "slug"])
      .where("restaurant_id", "=", restaurant.id).where("is_active", "=", true)
      .orderBy("created_at", "asc").orderBy("id", "asc").execute();
    return { id: restaurant.id, name: restaurant.name, subdomain: restaurant.subdomain, branches };
  }

  private async resolveBranch(slug: string) {
    const branch = await this.database.db.selectFrom("branches")
      .innerJoin("restaurants", "restaurants.id", "branches.restaurant_id")
      .select([
        "branches.id", "branches.name", "branches.slug", "branches.currency",
        "branches.restaurant_id", "restaurants.name as restaurant_name",
        "branches.is_active", "restaurants.is_active as restaurant_active",
      ])
      .where("branches.slug", "=", slug).executeTakeFirst();
    if (!branch || !branch.is_active || !branch.restaurant_active) {
      throw new NotFoundException("Menu not found");
    }
    await requireOperationalEntitlements(this.database.db, branch.restaurant_id, "menu");
    return branch;
  }

  async categories(slug: string, query: MenuPageDto) {
    const branch = await this.resolveBranch(slug);
    let select = this.database.db.selectFrom("categories").selectAll()
      .where("branch_id", "=", branch.id).where("archived_at", "is", null).where("is_active", "=", true);
    if (query.search) select = select.where(sql<boolean>`position(lower(${query.search}) in lower(name)) > 0`);
    if (query.cursor) {
      const cursor = decodeDisplayCursor(query.cursor);
      select = select.where(sql<boolean>`(sort_order,id) > (${cursor.sortOrder}::int,${cursor.id}::uuid)`);
    }
    const result = await select.orderBy("sort_order", "asc").orderBy("id", "asc").limit(query.limit + 1).execute();
    const hasMore = result.length > query.limit;
    const rows = result.slice(0, query.limit);
    const last = rows.at(-1);
    const data: CategoryDto[] = rows.map((row) => ({
      id: row.id, branchId: row.branch_id, name: row.name, description: row.description,
      sortOrder: row.sort_order, isActive: row.is_active, createdAt: row.created_at.toISOString(),
    }));
    return { data, meta: { hasMore, nextCursor: hasMore && last
      ? encodeDisplayCursor({ sortOrder: last.sort_order, id: last.id }) : null } };
  }

  async list(slug: string, query: MenuPageDto): Promise<{ data: PublicMenuDto; meta: { hasMore: boolean; nextCursor: string | null } }> {
    const branch = await this.resolveBranch(slug);
    let select = this.database.db.selectFrom("products")
      .innerJoin("categories", (join) => join.onRef("categories.id", "=", "products.category_id")
        .onRef("categories.branch_id", "=", "products.branch_id"))
      .selectAll("products")
      .where("products.branch_id", "=", branch.id).where("products.archived_at", "is", null)
      .where("products.is_visible", "=", true)
      .where("categories.archived_at", "is", null).where("categories.is_active", "=", true);
    if (query.search) select = select.where(sql<boolean>`position(lower(${query.search}) in lower(products.name)) > 0`);
    if (query.cursor) {
      const cursor = decodeDisplayCursor(query.cursor);
      select = select.where(sql<boolean>`(products.sort_order,products.id) > (${cursor.sortOrder}::int,${cursor.id}::uuid)`);
    }
    const result = await select.orderBy("products.sort_order", "asc").orderBy("products.id", "asc")
      .limit(query.limit + 1).execute();
    const hasMore = result.length > query.limit;
    const page = result.slice(0, query.limit);
    const images = await imagesForProducts(this.database.db, page.map((row) => row.id));
    const categoryIds = [...new Set(page.map((row) => row.category_id))];
    const categories = categoryIds.length ? await this.database.db.selectFrom("categories").selectAll()
      .where("id", "in", categoryIds).execute() : [];
    const last = page.at(-1);
    return {
      data: {
        restaurant: { name: branch.restaurant_name },
        branch: { name: branch.name, slug: branch.slug, currency: branch.currency },
        products: page.map((row) => productDto(row, images.get(row.id) ?? [])),
        categories: categories.map((row) => ({
          id: row.id, branchId: row.branch_id, name: row.name, description: row.description,
          sortOrder: row.sort_order, isActive: row.is_active, createdAt: row.created_at.toISOString(),
        })),
      },
      meta: { hasMore, nextCursor: hasMore && last
        ? encodeDisplayCursor({ sortOrder: last.sort_order, id: last.id }) : null },
    };
  }
}
