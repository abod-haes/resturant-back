import { RUNTIME_CONFIG, type RuntimeConfig } from "../../../common/config/runtime-config";
import { managedImagePath } from "../../../common/tenancy/managed-image-path";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../../database/database.service";
import type { AuthPrincipal } from "../../../common/auth/principal";
import { lockMediaTenant, ownerTenant, requireMediaBranch } from "./media-access";
import type { GalleryImageDto, ReplaceGalleryDto } from "../presentation/media.dto";

@Injectable()
export class ProductGalleryService {
  constructor(private readonly database: DatabaseService, @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  async list(principal: AuthPrincipal, branchId: string, productId: string): Promise<GalleryImageDto[]> {
    const tenant = ownerTenant(principal);
    await requireMediaBranch(this.database.db, principal, branchId);
    const product = await this.database.db.selectFrom("products").select("id")
      .where("id", "=", productId).where("restaurant_id", "=", tenant)
      .where("branch_id", "=", branchId).where("archived_at", "is", null).executeTakeFirst();
    if (!product) throw new NotFoundException("Product not found");
    const rows = await this.database.db.selectFrom("product_images")
      .select(["id","media_asset_id","url","alt","sort_order"])
      .where("product_id", "=", productId).where("restaurant_id", "=", tenant)
      .orderBy("sort_order", "asc").execute();
    return rows.map(row => ({
      id: row.id, mediaId: row.media_asset_id, url: row.url, path: row.media_asset_id ? managedImagePath(row.url, tenant, this.config.mediaStorage?.publicOrigin, row.media_asset_id) : null, alt: row.alt,
      sortOrder: row.sort_order, isPrimary: row.sort_order === 0,
    }));
  }

  async replace(principal: AuthPrincipal, branchId: string, productId: string, body: ReplaceGalleryDto,
    requestId?: string): Promise<GalleryImageDto[]> {
    if (!Array.isArray(body.images) || body.images.length > 8) {
      throw new BadRequestException("Product gallery supports at most eight images");
    }
    const ids = body.images.map(image => image.mediaId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException({ code: "MEDIA_DUPLICATED", message: "Duplicate media in gallery" });
    }
    const tenant = ownerTenant(principal);
    await this.database.db.transaction().execute(async trx => {
      await lockMediaTenant(trx, principal);
      await requireMediaBranch(trx, principal, branchId);
      const product = await trx.selectFrom("products").select("id")
        .where("id", "=", productId).where("restaurant_id", "=", tenant)
        .where("branch_id", "=", branchId).where("archived_at", "is", null)
        .forUpdate().executeTakeFirst();
      if (!product) throw new NotFoundException("Product not found");
      const assets = ids.length ? await trx.selectFrom("media_assets")
        .select(["id","public_url"]).where("id", "in", ids)
        .where("restaurant_id", "=", tenant).where("status", "=", "ready")
        .where("kind", "=", "image").orderBy("id", "asc").forUpdate().execute() : [];
      if (assets.length !== ids.length || assets.some(asset => asset.public_url === null)) {
        throw new NotFoundException("Media asset not found");
      }
      const urls = new Map(assets.map(asset => [asset.id, asset.public_url!]));
      await trx.deleteFrom("product_images").where("product_id", "=", productId).execute();
      if (ids.length) await trx.insertInto("product_images").values(body.images.map((image, order) => ({
        product_id: productId, branch_id: branchId, restaurant_id: tenant,
        media_asset_id: image.mediaId, url: urls.get(image.mediaId)!,
        alt: image.alt ?? null, sort_order: order,
      }))).execute();
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: tenant,
        action: "menu.product.gallery_updated", entity_type: "product", entity_id: productId,
        request_id: requestId ?? null, metadata: { branchId, count: ids.length },
      }).execute();
    });
    return this.list(principal, branchId, productId);
  }
}
