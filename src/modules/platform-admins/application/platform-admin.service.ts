import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from "@nestjs/common";
import { sql } from "kysely";
import type { AuthPrincipal } from "../../../common/auth/principal";
import { hashPassword } from "../../../common/crypto/password";
import { decodeKeysetCursor, encodeKeysetCursor } from "../../../common/pagination/keyset";
import { DatabaseService } from "../../../database/database.service";
import type {
  CreatePlatformAdminDto, PlatformAdminDto, PlatformAdminListQueryDto,
  PlatformAdminListResponseDto, UpdatePlatformAdminDto,
} from "../presentation/platform-admin.dto";

type AdminRow = {
  id: string;
  username: string;
  display_name: string;
  is_active: boolean;
  must_change_password: boolean;
  created_at: Date;
};

function toDto(row: AdminRow): PlatformAdminDto {
  return {
    id: row.id,
    username: row.username,
    name: row.display_name,
    role: "PLATFORM_ADMIN",
    isActive: row.is_active,
    mustChangePassword: false,
    createdAt: row.created_at.toISOString(),
  };
}

function usernameTaken(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "23505" &&
    "constraint" in error && error.constraint === "users_username_ci_unique";
}

@Injectable()
export class PlatformAdminService {
  constructor(private readonly database: DatabaseService) {}

  private query() {
    return this.database.db.selectFrom("users")
      .select(["id", "username", "display_name", "is_active", "must_change_password", "created_at"])
      .where("role", "=", "PLATFORM_ADMIN");
  }

  async create(dto: CreatePlatformAdminDto, actor: AuthPrincipal, requestId?: string): Promise<PlatformAdminDto> {
    const passwordHash = await hashPassword(dto.initialPassword);
    try {
      const user = await this.database.db.transaction().execute(async (trx) => {
        const created = await trx.insertInto("users").values({
          username: dto.username,
          display_name: dto.name.trim(),
          password_hash: passwordHash,
          role: "PLATFORM_ADMIN",
          restaurant_id: null,
          branch_id: null,
          department: null,
          must_change_password: false,
          is_active: true,
        }).returning(["id", "username", "display_name", "is_active", "must_change_password", "created_at"])
          .executeTakeFirstOrThrow();
        await trx.insertInto("audit_logs").values({
          actor_user_id: actor.id, restaurant_id: null,
          action: "platform_admin.created", entity_type: "user", entity_id: created.id,
          request_id: requestId ?? null, metadata: {},
        }).execute();
        return created;
      });
      return toDto(user);
    } catch (error: unknown) {
      if (usernameTaken(error)) {
        throw new ConflictException({
          code: "PLATFORM_ADMIN_USERNAME_TAKEN",
          message: "Username is already in use",
        });
      }
      throw error;
    }
  }

  async list(input: PlatformAdminListQueryDto): Promise<PlatformAdminListResponseDto> {
    let query = this.query().select(
      sql<string>`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("cursor_timestamp"),
    );
    if (input.search) {
      query = query.where(sql<boolean>`(position(lower(${input.search}) in lower(username)) > 0 OR position(lower(${input.search}) in lower(display_name)) > 0)`);
    }
    if (input.cursor) {
      const cursor = decodeKeysetCursor(input.cursor);
      query = query.where(sql<boolean>`(created_at, id) < (${cursor.timestamp}::timestamptz, ${cursor.id}::uuid)`);
    }
    const rows = await query.orderBy("created_at", "desc").orderBy("id", "desc")
      .limit(input.limit + 1).execute();
    const hasMore = rows.length > input.limit;
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return {
      data: page.map(toDto),
      meta: {
        hasMore,
        nextCursor: hasMore && last
          ? encodeKeysetCursor({ timestamp: last.cursor_timestamp, id: last.id }) : null,
      },
    };
  }

  async get(id: string): Promise<PlatformAdminDto> {
    const row = await this.query().where("id", "=", id).executeTakeFirst();
    if (!row) throw new NotFoundException("Platform administrator not found");
    return toDto(row);
  }

  async update(id: string, dto: UpdatePlatformAdminDto, actor: AuthPrincipal, requestId?: string): Promise<PlatformAdminDto> {
    const patch: { display_name?: string; is_active?: boolean } = {};
    if (dto.name !== undefined) patch.display_name = dto.name.trim();
    if (dto.isActive !== undefined) patch.is_active = dto.isActive;
    if (!Object.keys(patch).length) throw new BadRequestException("At least one field is required");

    const changed = await this.database.db.transaction().execute(async (trx) => {
      const updated = await trx.updateTable("users").set(patch)
        .where("id", "=", id).where("role", "=", "PLATFORM_ADMIN")
        .returning(["id", "username", "display_name", "is_active", "must_change_password", "created_at"])
        .executeTakeFirst();
      if (!updated) throw new NotFoundException("Platform administrator not found");
      if (dto.isActive === false) {
        await trx.updateTable("auth_sessions").set({ revoked_at: new Date() })
          .where("user_id", "=", id).where("revoked_at", "is", null).execute();
      }
      await trx.insertInto("audit_logs").values({
        actor_user_id: actor.id, restaurant_id: null,
        action: "platform_admin.updated", entity_type: "user", entity_id: id,
        request_id: requestId ?? null, metadata: { fields: Object.keys(patch).sort() },
      }).execute();
      return updated;
    });
    return toDto(changed);
  }

  async resetPassword(id: string, initialPassword: string, actor: AuthPrincipal, requestId?: string): Promise<void> {
    const hash = await hashPassword(initialPassword);
    await this.database.db.transaction().execute(async (trx) => {
      const updated = await trx.updateTable("users")
        .set({ password_hash: hash, must_change_password: false })
        .where("id", "=", id).where("role", "=", "PLATFORM_ADMIN")
        .returning("id").executeTakeFirst();
      if (!updated) throw new NotFoundException("Platform administrator not found");
      await trx.updateTable("auth_sessions").set({ revoked_at: new Date() })
        .where("user_id", "=", id).where("revoked_at", "is", null).execute();
      await trx.insertInto("audit_logs").values({
        actor_user_id: actor.id, restaurant_id: null,
        action: "platform_admin.password_reset", entity_type: "user", entity_id: id,
        request_id: requestId ?? null, metadata: {},
      }).execute();
    });
  }
}
