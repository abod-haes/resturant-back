import { Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { decodeKeysetCursor, encodeKeysetCursor } from "../../../common/pagination/keyset";
import { DatabaseService } from "../../../database/database.service";
import type { AdminAuditQueryDto, AdminAuditResponseDto } from "../presentation/audit.dto";

@Injectable()
export class AdminAuditService {
  constructor(private readonly database: DatabaseService) {}

  async list(query: AdminAuditQueryDto): Promise<AdminAuditResponseDto> {
    // This is a PRIMARY_ADMIN-only global action. Raw metadata can include
    // credentials, private contacts or operational notes and is never selected.
    let qb = this.database.db.selectFrom("audit_logs")
      .select(["id","actor_user_id","restaurant_id","action","entity_type",
        "entity_id","request_id","created_at"])
      .select(sql<string>`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("cursor_timestamp"));
    if (query.restaurantId) qb = qb.where("restaurant_id", "=", query.restaurantId);
    if (query.actorId) qb = qb.where("actor_user_id", "=", query.actorId);
    if (query.action) qb = qb.where("action", "=", query.action);
    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor);
      qb = qb.where(sql<boolean>`(created_at,id)<(${cursor.timestamp}::timestamptz,${cursor.id}::uuid)`);
    }
    const rows = await qb.orderBy("created_at","desc").orderBy("id","desc")
      .limit(query.limit + 1).execute();
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit), last = page.at(-1);
    return {
      data: page.map(row => ({
        id: row.id, actorId: row.actor_user_id, restaurantId: row.restaurant_id,
        action: row.action, entityType: row.entity_type, entityId: row.entity_id,
        requestId: row.request_id, createdAt: row.created_at.toISOString(),
      })),
      meta: { hasMore, nextCursor: hasMore && last
        ? encodeKeysetCursor({ timestamp: last.cursor_timestamp, id: last.id }) : null },
    };
  }
}
