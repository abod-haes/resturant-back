import {
  ConflictException, ForbiddenException, Injectable, Inject, NotFoundException,
} from "@nestjs/common";
import { RUNTIME_CONFIG, type RuntimeConfig } from "../../../common/config/runtime-config";
import type { AuthPrincipal } from "../../../common/auth/principal";
import { requireOperationalEntitlements } from "../../../common/subscription/operational-entitlement";
import { DatabaseService } from "../../../database/database.service";
import {
  customerQrUrl, decryptQrToken, encryptQrToken, generateQrToken, hashQrToken, isValidQrToken,
} from "../domain/qr-credential";
import type { PublicTableContextDto, QrCodeDataDto } from "../presentation/tables.dto";
import { lockRestaurant, ownerBranch, requireQrConfig } from "./table-access";

@Injectable()
export class QrService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  private async ownerTable(principal: AuthPrincipal, tableId: string) {
    if (!principal.restaurantId) throw new ForbiddenException("Restaurant scope required");
    const table = await this.database.db.selectFrom("restaurant_tables").selectAll()
      .where("id", "=", tableId).where("restaurant_id", "=", principal.restaurantId)
      .where("archived_at", "is", null).executeTakeFirst();
    if (!table) throw new NotFoundException("Table not found");
    await ownerBranch(this.database.db, principal, table.branch_id);
    return table;
  }

  async get(principal: AuthPrincipal, tableId: string): Promise<QrCodeDataDto> {
    const table = await this.ownerTable(principal, tableId);
    const { key, origin } = requireQrConfig(this.config);
    const credential = await this.database.db.selectFrom("qr_credentials")
      .select(["token_box", "version"]).where("table_id", "=", tableId)
      .where("revoked_at", "is", null).executeTakeFirst();
    if (!credential) throw new ConflictException({
      code: "QR_REVOKED", message: "QR token is revoked",
    });
    return { url: customerQrUrl(origin, decryptQrToken(credential.token_box, key)),
      version: credential.version, enabled: table.qr_enabled && table.is_active };
  }

  async rotate(principal: AuthPrincipal, tableId: string, requestId?: string): Promise<QrCodeDataDto> {
    const { key, origin } = requireQrConfig(this.config);
    return this.database.db.transaction().execute(async (trx) => {
      await lockRestaurant(trx, principal);
      if (!principal.restaurantId) throw new ForbiddenException("Restaurant scope required");
      const table = await trx.selectFrom("restaurant_tables").selectAll()
        .where("id", "=", tableId).where("restaurant_id", "=", principal.restaurantId)
        .where("archived_at", "is", null).forUpdate().executeTakeFirst();
      if (!table) throw new NotFoundException("Table not found");
      await ownerBranch(trx, principal, table.branch_id);
      await trx.updateTable("qr_credentials").set({ revoked_at: new Date() })
        .where("table_id", "=", tableId).where("revoked_at", "is", null).execute();
      const version = table.qr_version + 1;
      await trx.updateTable("restaurant_tables").set({ qr_version: version })
        .where("id", "=", tableId).execute();
      const token = generateQrToken();
      await trx.insertInto("qr_credentials").values({
        table_id: tableId, branch_id: table.branch_id, version,
        token_hash: hashQrToken(token), token_box: encryptQrToken(token, key), revoked_at: null,
      }).execute();
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: table.restaurant_id,
        action: "table.qr.rotated", entity_type: "table", entity_id: tableId,
        request_id: requestId ?? null, metadata: { branchId: table.branch_id, version },
      }).execute();
      // Rotation deliberately preserves the previous enabled/disabled state.
      return { url: customerQrUrl(origin, token), version,
        enabled: table.qr_enabled && table.is_active };
    });
  }

  async disable(principal: AuthPrincipal, tableId: string, requestId?: string) {
    return this.database.db.transaction().execute(async (trx) => {
      await lockRestaurant(trx, principal);
      if (!principal.restaurantId) throw new ForbiddenException("Restaurant scope required");
      const table = await trx.selectFrom("restaurant_tables").selectAll()
        .where("id", "=", tableId).where("restaurant_id", "=", principal.restaurantId)
        .where("archived_at", "is", null).forUpdate().executeTakeFirst();
      if (!table) throw new NotFoundException("Table not found");
      await ownerBranch(trx, principal, table.branch_id);
      const updated = await trx.updateTable("restaurant_tables")
        .set({ qr_enabled: false }).where("id", "=", tableId).returning("qr_version")
        .executeTakeFirstOrThrow();
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id, restaurant_id: table.restaurant_id,
        action: "table.qr.disabled", entity_type: "table", entity_id: tableId,
        request_id: requestId ?? null, metadata: { branchId: table.branch_id },
      }).execute();
      return { enabled: false, version: updated.qr_version };
    });
  }

  async resolvePublic(token: string): Promise<PublicTableContextDto> {
    if (!isValidQrToken(token)) throw new NotFoundException("QR not found");
    const hash = hashQrToken(token);
    const row = await this.database.db.selectFrom("qr_credentials")
      .innerJoin("restaurant_tables", "restaurant_tables.id", "qr_credentials.table_id")
      .innerJoin("areas", "areas.id", "restaurant_tables.area_id")
      .innerJoin("floors", "floors.id", "areas.floor_id")
      .innerJoin("branches", "branches.id", "restaurant_tables.branch_id")
      .innerJoin("restaurants", "restaurants.id", "restaurant_tables.restaurant_id")
      .select([
        "qr_credentials.version", "restaurant_tables.id as table_id",
        "restaurant_tables.label as table_label", "restaurant_tables.qr_version",
        "restaurant_tables.is_active as table_active", "restaurant_tables.qr_enabled",
        "restaurant_tables.archived_at as table_archived",
        "areas.is_active as area_active", "areas.archived_at as area_archived",
        "floors.is_active as floor_active", "floors.archived_at as floor_archived",
        "branches.is_active as branch_active", "branches.name as branch_name", "branches.slug",
        "restaurants.is_active as restaurant_active", "restaurants.id as restaurant_id",
        "restaurants.name as restaurant_name",
      ])
      .where("qr_credentials.token_hash", "=", hash)
      .where("qr_credentials.revoked_at", "is", null).executeTakeFirst();
    if (!row || row.version !== row.qr_version || !row.table_active || !row.qr_enabled
      || row.table_archived || !row.area_active || row.area_archived || !row.floor_active
      || row.floor_archived || !row.branch_active || !row.restaurant_active) {
      throw new NotFoundException({ code: "QR_REVOKED", message: "QR is unavailable" });
    }
    await requireOperationalEntitlements(this.database.db, row.restaurant_id, "menu");
    return {
      restaurant: { name: row.restaurant_name },
      branch: { name: row.branch_name, slug: row.slug },
      table: { id: row.table_id, label: row.table_label },
      menuPath: "/api/v1/public/menu/" + row.slug,
      callsAvailable: false,
    };
  }

  async printable(principal: AuthPrincipal, branchId: string, selectedIds: string[] | null) {
    const { key, origin } = requireQrConfig(this.config);
    await ownerBranch(this.database.db, principal, branchId);
    let query = this.database.db.selectFrom("restaurant_tables")
      .innerJoin("areas", (join) => join.onRef("areas.id", "=", "restaurant_tables.area_id")
        .onRef("areas.branch_id", "=", "restaurant_tables.branch_id"))
      .innerJoin("floors", (join) => join.onRef("floors.id", "=", "areas.floor_id")
        .onRef("floors.branch_id", "=", "areas.branch_id"))
      .select(["restaurant_tables.id", "restaurant_tables.label", "restaurant_tables.sort_order"])
      .where("restaurant_tables.branch_id", "=", branchId)
      .where("restaurant_tables.archived_at", "is", null)
      .where("restaurant_tables.is_active", "=", true)
      .where("restaurant_tables.qr_enabled", "=", true)
      .where("areas.archived_at", "is", null).where("areas.is_active", "=", true)
      .where("floors.archived_at", "is", null).where("floors.is_active", "=", true);
    if (selectedIds) query = query.where("restaurant_tables.id", "in", selectedIds);
    const rows = await query.orderBy("restaurant_tables.sort_order", "asc")
      .orderBy("restaurant_tables.id", "asc").limit(101).execute();
    if (rows.length > 100) throw new ConflictException({
      code: "QR_PRINT_TOO_MANY", message: "Print at most 100 tables per PDF",
    });
    if (selectedIds && rows.length !== selectedIds.length) {
      throw new NotFoundException("One or more selected tables are not active and accessible");
    }
    const items: { id: string; label: string; url: string }[] = [];
    for (const table of rows) {
      const credential = await this.database.db.selectFrom("qr_credentials")
        .select("token_box").where("table_id", "=", table.id)
        .where("revoked_at", "is", null).executeTakeFirst();
      if (!credential) throw new ConflictException({ code: "QR_REVOKED", message: "QR revoked" });
      items.push({
        id: table.id, label: table.label,
        url: customerQrUrl(origin, decryptQrToken(credential.token_box, key)),
      });
    }
    return items;
  }
}
