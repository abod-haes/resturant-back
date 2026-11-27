import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { sql, type Selectable } from "kysely";
import { DatabaseService } from "../../../database/database.service";
import type { AuthPrincipal } from "../../../common/auth/principal";
import { requireOperationalEntitlements } from "../../../common/subscription/operational-entitlement";
import { RUNTIME_CONFIG, type RuntimeConfig } from "../../../common/config/runtime-config";
import { MAX_ACTIVE_DEVICES, pushTokenHash, sealPushToken, validExpoPushToken } from "../../../common/push/push-token";
import type { EmployeePushDevicesTable } from "../../../database/database.types";
import type { PushDeviceDto, RegisterPushDeviceDto } from "../presentation/push.dto";

function toView(row: Selectable<EmployeePushDevicesTable>): PushDeviceDto {
  if (row.channel !== 'expo' || row.platform === 'web') throw new Error('Invalid Expo device');
  return { id: row.id, platform: row.platform, isActive: row.is_active,
    lastSeenAt: row.last_seen_at.toISOString(), createdAt: row.created_at.toISOString() };
}
function requireEmployee(principal: AuthPrincipal): { restaurantId: string; branchId: string; department: "waiter" | "hookah" } {
  if (principal.role !== "EMPLOYEE" || !principal.restaurantId || !principal.branchId || !principal.department) {
    throw new ForbiddenException("Employee account required");
  }
  return { restaurantId: principal.restaurantId, branchId: principal.branchId, department: principal.department };
}
@Injectable()
export class DeviceRegistryService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  async register(principal: AuthPrincipal, payload: RegisterPushDeviceDto): Promise<PushDeviceDto> {
    const { restaurantId, department } = requireEmployee(principal);
    if (!this.config.pushTokenEncryptionKey) {
      throw new ServiceUnavailableException({ code: "PUSH_NOT_CONFIGURED",
        message: "Push device registration is not configured" });
    }
    if (!validExpoPushToken(payload.expoPushToken)) {
      throw new ForbiddenException("Invalid Expo push token");
    }
    const tokenHash = pushTokenHash(payload.expoPushToken);
    const box = sealPushToken(payload.expoPushToken, this.config.pushTokenEncryptionKey);
    try {
      return await this.database.db.transaction().execute(async trx => {
        const user = await trx.selectFrom("users").select(["id", "is_active", "archived_at"])
          .where("id", "=", principal.id).forUpdate().executeTakeFirst();
        if (!user?.is_active || user.archived_at) throw new ForbiddenException("Employee inactive");
        await requireOperationalEntitlements(trx, restaurantId,
          department === "waiter" ? "waiter_calls" : "hookah_calls");
        const current = await trx.selectFrom("employee_push_devices").selectAll()
          .where("channel", "=", "expo").where("token_hash", "=", tokenHash).forUpdate().executeTakeFirst();
        if (current && current.user_id !== principal.id) {
          throw new ConflictException({ code: "DEVICE_ALREADY_REGISTERED",
            message: "Push token belongs to another employee; unregister the old account first" });
        }
        const count = await trx.selectFrom("employee_push_devices")
          .select(sql<number>`count(*)::int`.as("count"))
          .where("user_id", "=", principal.id).where("channel", "=", "expo").where("is_active", "=", true)
          .executeTakeFirstOrThrow();
        if ((!current || !current.is_active) && count.count >= MAX_ACTIVE_DEVICES) {
          throw new ConflictException({ code: "DEVICE_LIMIT_REACHED",
            message: "At most five active devices per employee" });
        }
        const row = current
          ? await trx.updateTable("employee_push_devices")
            .set({ platform: payload.platform, token_box: box, is_active: true, last_seen_at: new Date() })
            .where("id", "=", current.id).returningAll().executeTakeFirstOrThrow()
          : await trx.insertInto("employee_push_devices")
            .values({ user_id: principal.id, platform: payload.platform, token_hash: tokenHash,
              token_box: box }).returningAll().executeTakeFirstOrThrow();
        return toView(row);
      });
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        throw new ConflictException({ code: "DEVICE_ALREADY_REGISTERED", message: "Push token already registered" });
      }
      throw error;
    }
  }

  async list(principal: AuthPrincipal): Promise<PushDeviceDto[]> {
    const { restaurantId } = requireEmployee(principal);
    await requireOperationalEntitlements(this.database.db, restaurantId);
    const rows = await this.database.db.selectFrom("employee_push_devices").selectAll()
      .where("user_id", "=", principal.id).where("channel", "=", "expo").where("is_active", "=", true)
      .orderBy("last_seen_at", "desc").limit(MAX_ACTIVE_DEVICES).execute();
    return rows.map(toView);
  }

  async unregister(principal: AuthPrincipal, deviceId: string): Promise<{ unregistered: true }> {
    requireEmployee(principal);
    const row = await this.database.db.updateTable("employee_push_devices")
      .set({ is_active: false }).where("id", "=", deviceId)
      .where("user_id", "=", principal.id).where("channel", "=", "expo").where("is_active", "=", true)
      .returning("id").executeTakeFirst();
    if (!row) throw new NotFoundException("Device not registered to current employee");
    return { unregistered: true };
  }
}
