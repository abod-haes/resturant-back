import {
  ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql, type Selectable } from "kysely";
import { DatabaseService } from "../../../database/database.service";
import type { MediaAssetsTable, MediaKind } from "../../../database/database.types";
import type { AuthPrincipal } from "../../../common/auth/principal";
import { RUNTIME_CONFIG, type RuntimeConfig } from "../../../common/config/runtime-config";
import { decodeKeysetCursor, encodeKeysetCursor } from "../../../common/pagination/keyset";
import { MAX_MEDIA_ASSETS, processMedia } from "../domain/media-content";
import { MEDIA_STORAGE, type MediaStorageGateway } from "../infrastructure/media-storage.gateway";
import type { MediaDto, MediaListQueryDto } from "../presentation/media.dto";
import { lockMediaTenant, ownerTenant, requireMediaBranch } from "./media-access";

type MediaRow = Selectable<MediaAssetsTable>;
function toMedia(row: MediaRow): MediaDto {
  return {
    id: row.id, branchId: row.branch_id, kind: row.kind, url: row.public_url,
    name: row.original_name, contentType: row.content_type,
    byteSize: row.byte_size, width: row.width, height: row.height,
    createdAt: row.created_at.toISOString(),
  };
}

@Injectable()
export class MediaService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorageGateway,
  ) {}

  private ensureStorage(): NonNullable<RuntimeConfig["mediaStorage"]> {
    if (!this.config.mediaStorage) throw new ServiceUnavailableException({
      code: "MEDIA_STORAGE_NOT_CONFIGURED", message: "Media storage is not configured",
    });
    return this.config.mediaStorage;
  }

  async upload(principal: AuthPrincipal, branchId: string, kind: MediaKind,
    file?: Express.Multer.File, requestId?: string): Promise<MediaDto> {
    const config = this.ensureStorage();
    const processed = await processMedia(kind, file);
    const tenant = ownerTenant(principal);
    const id = randomUUID();
    const objectKey = "r/" + tenant + "/" + id + (kind === "image" ? ".webp" : ".pdf");
    const publicUrl = kind === "image" ? config.publicOrigin + "/" + objectKey : null;
    await this.database.db.transaction().execute(async trx => {
      await lockMediaTenant(trx, principal);
      await requireMediaBranch(trx, principal, branchId);
      const active = await trx.selectFrom("media_assets")
        .select(sql<number>`count(*)::int`.as("count"))
        .where("restaurant_id", "=", tenant).where("status", "!=", "deleted")
        .executeTakeFirstOrThrow();
      if (active.count >= MAX_MEDIA_ASSETS) throw new ConflictException({
        code: "MEDIA_LIBRARY_LIMIT", message: "Restaurant media library limit reached",
      });
      await trx.insertInto("media_assets").values({
        id, restaurant_id: tenant, branch_id: branchId, kind,
        object_key: objectKey, public_url: publicUrl, original_name: processed.originalName,
        content_type: processed.contentType, byte_size: processed.body.length,
        width: processed.width, height: processed.height, status: "uploading",
      }).execute();
    });
    // No DB transaction spans an external network call; upload states are durable
    // and the cleanup command handles abandoned/incomplete objects safely.
    try {
      await this.storage.put(objectKey, processed.body, processed.contentType);
    } catch {
      await this.database.db.updateTable("media_assets").set({ status: "deleting" })
        .where("id", "=", id).where("status", "=", "uploading").execute();
      throw new ServiceUnavailableException({ code: "MEDIA_UPLOAD_FAILED", message: "Object storage upload failed" });
    }
    const completed = await this.database.db.updateTable("media_assets")
      .set({ status: "ready" }).where("id", "=", id).where("status", "=", "uploading")
      .returningAll().executeTakeFirstOrThrow();
    await this.database.db.insertInto("audit_logs").values({
      actor_user_id: principal.id, restaurant_id: tenant,
      action: "media.uploaded", entity_type: "media_asset", entity_id: id,
      request_id: requestId ?? null,
      metadata: { branchId, kind, contentType: processed.contentType, bytes: processed.body.length },
    }).execute();
    return toMedia(completed);
  }

  async list(principal: AuthPrincipal, branchId: string, query: MediaListQueryDto) {
    const tenant = ownerTenant(principal);
    await requireMediaBranch(this.database.db, principal, branchId);
    let rows = this.database.db.selectFrom("media_assets").selectAll()
      .select(sql<string>`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("cursor_timestamp"))
      .where("restaurant_id", "=", tenant).where("branch_id", "=", branchId)
      .where("status", "=", "ready");
    if (query.kind) rows = rows.where("kind", "=", query.kind);
    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor);
      rows = rows.where(sql<boolean>`(created_at,id) < (${cursor.timestamp}::timestamptz,${cursor.id}::uuid)`);
    }
    const result = await rows.orderBy("created_at", "desc").orderBy("id", "desc")
      .limit(query.limit + 1).execute();
    const hasMore = result.length > query.limit;
    const page = result.slice(0, query.limit);
    const last = page.at(-1);
    return { data: page.map(toMedia), meta: { hasMore,
      nextCursor: hasMore && last ? encodeKeysetCursor({ timestamp: last.cursor_timestamp, id: last.id }) : null } };
  }

  private async ownedReady(principal: AuthPrincipal, branchId: string, assetId: string) {
    await requireMediaBranch(this.database.db, principal, branchId);
    const asset = await this.database.db.selectFrom("media_assets").selectAll()
      .where("id", "=", assetId).where("restaurant_id", "=", ownerTenant(principal))
      .where("branch_id", "=", branchId).where("status", "=", "ready").executeTakeFirst();
    if (!asset) throw new NotFoundException("Media asset not found");
    return asset;
  }

  async documentDownload(principal: AuthPrincipal, branchId: string, assetId: string) {
    this.ensureStorage();
    const asset = await this.ownedReady(principal, branchId, assetId);
    if (asset.kind !== "document") throw new NotFoundException("Document not found");
    const url = await this.storage.privateDownloadUrl(asset.object_key, asset.original_name);
    return { url, expiresInSeconds: 60 };
  }

  async remove(principal: AuthPrincipal, branchId: string, assetId: string, requestId?: string) {
    const tenant = ownerTenant(principal);
    this.ensureStorage();
    const objectKey = await this.database.db.transaction().execute(async trx => {
      await lockMediaTenant(trx, principal);
      await requireMediaBranch(trx, principal, branchId);
      const asset = await trx.selectFrom("media_assets").selectAll().where("id", "=", assetId)
        .where("restaurant_id", "=", tenant).where("branch_id", "=", branchId)
        .where("status", "=", "ready").forUpdate().executeTakeFirst();
      if (!asset) throw new NotFoundException("Media asset not found");
      const attached = await trx.selectFrom("product_images").select("id")
        .where(eb => eb.or([
          eb("media_asset_id", "=", assetId),
          ...(asset.public_url ? [eb("url", "=", asset.public_url)] : []),
        ])).limit(1).executeTakeFirst();
      if (attached) throw new ConflictException({
        code: "MEDIA_IN_USE", message: "Remove media from products before deleting it",
      });
      await trx.updateTable("media_assets").set({ status: "deleting" })
        .where("id", "=", assetId).execute();
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: tenant,
        action: "media.deleted", entity_type: "media_asset", entity_id: assetId,
        request_id: requestId ?? null, metadata: { branchId, kind: asset.kind },
      }).execute();
      return asset.object_key;
    });
    try {
      await this.storage.delete(objectKey);
      await this.database.db.updateTable("media_assets").set({ status: "deleted" })
        .where("id", "=", assetId).where("status", "=", "deleting").execute();
    } catch {
      // Keep 'deleting' for cleanup retry. Never publish a stale link again.
      throw new ServiceUnavailableException({
        code: "MEDIA_DELETE_PENDING", message: "Deletion queued for retry",
      });
    }
    return { deleted: true };
  }

  /** Run from an explicit scheduled maintenance command, not from API replicas. */
  async cleanup(): Promise<{ scanned: number; deleted: number; failed: number }> {
    this.ensureStorage();
    const abandoned = new Date(Date.now() - 60 * 60 * 1000);
    const unused = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const candidates = await this.database.db.selectFrom("media_assets")
      .select(["id", "restaurant_id"]).where(eb => eb.or([
        eb("status", "=", "deleting"),
        eb.and([eb("status", "=", "uploading"), eb("created_at", "<", abandoned)]),
        eb.and([eb("status", "=", "ready"), eb("kind", "=", "image"), eb("created_at", "<", unused)]),
      ])).orderBy("created_at", "asc").limit(100).execute();
    let deleted = 0, failed = 0;
    for (const candidate of candidates) {
      const objectKey = await this.database.db.transaction().execute(async trx => {
        // Consistent tenant row locking with product/gallery writes and manual delete.
        await trx.selectFrom("restaurants").select("id")
          .where("id", "=", candidate.restaurant_id).forUpdate().executeTakeFirstOrThrow();
        const asset = await trx.selectFrom("media_assets").selectAll()
          .where("id", "=", candidate.id).forUpdate().executeTakeFirst();
        if (!asset || asset.status === "deleted") return null;
        const eligible = asset.status === "deleting" ||
          (asset.status === "uploading" && asset.created_at < abandoned) ||
          (asset.status === "ready" && asset.kind === "image" && asset.created_at < unused);
        if (!eligible) return null;
        const attached = await trx.selectFrom("product_images").select("id")
          .where(eb => eb.or([
            eb("media_asset_id", "=", asset.id),
            ...(asset.public_url ? [eb("url", "=", asset.public_url)] : []),
          ])).limit(1).executeTakeFirst();
        if (attached) return null;
        if (asset.status !== "deleting") await trx.updateTable("media_assets")
          .set({ status: "deleting" }).where("id", "=", asset.id).execute();
        return asset.object_key;
      });
      if (!objectKey) continue;
      try {
        await this.storage.delete(objectKey);
        await this.database.db.updateTable("media_assets").set({ status: "deleted" })
          .where("id", "=", candidate.id).where("status", "=", "deleting").execute();
        deleted++;
      } catch {
        failed++;
      }
    }
    return { scanned: candidates.length, deleted, failed };
  }
}
