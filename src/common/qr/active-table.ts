import { NotFoundException } from "@nestjs/common";
import type { Kysely, Transaction } from "kysely";
import type { DatabaseTables } from "../../database/database.types";

type Db = Kysely<DatabaseTables> | Transaction<DatabaseTables>;

/** Shared branch/area/floor/table/credential validity predicate for QR visit and call entrypoints. */
export async function activeQrTable(db: Db, credentialId: string) {
  const row = await db.selectFrom("qr_credentials")
    .innerJoin("restaurant_tables", (join) => join.onRef("restaurant_tables.id", "=", "qr_credentials.table_id")
      .onRef("restaurant_tables.branch_id", "=", "qr_credentials.branch_id"))
    .innerJoin("areas", (join) => join.onRef("areas.id", "=", "restaurant_tables.area_id")
      .onRef("areas.branch_id", "=", "restaurant_tables.branch_id"))
    .innerJoin("floors", (join) => join.onRef("floors.id", "=", "areas.floor_id")
      .onRef("floors.branch_id", "=", "areas.branch_id"))
    .innerJoin("branches", (join) => join.onRef("branches.id", "=", "restaurant_tables.branch_id")
      .onRef("branches.restaurant_id", "=", "restaurant_tables.restaurant_id"))
    .innerJoin("restaurants", "restaurants.id", "restaurant_tables.restaurant_id")
    .select([
      "qr_credentials.id as credential_id", "qr_credentials.version as credential_version",
      "qr_credentials.revoked_at", "restaurant_tables.id as table_id",
      "restaurant_tables.label as table_label", "restaurant_tables.restaurant_id",
      "restaurant_tables.branch_id", "restaurant_tables.qr_version",
      "restaurant_tables.qr_enabled", "restaurant_tables.calls_enabled",
      "restaurant_tables.is_active as table_active", "restaurant_tables.archived_at as table_archived",
      "areas.is_active as area_active", "areas.archived_at as area_archived",
      "floors.is_active as floor_active", "floors.archived_at as floor_archived",
      "branches.is_active as branch_active", "restaurants.is_active as restaurant_active",
      "branches.name as branch_name", "branches.slug as branch_slug",
      "restaurants.name as restaurant_name",
    ])
    .where("qr_credentials.id", "=", credentialId).executeTakeFirst();
  if (!row || row.revoked_at || row.credential_version !== row.qr_version
    || !row.qr_enabled || !row.table_active || row.table_archived
    || !row.area_active || row.area_archived || !row.floor_active || row.floor_archived
    || !row.branch_active || !row.restaurant_active) {
    throw new NotFoundException({ code: "QR_REVOKED", message: "Table QR is unavailable" });
  }
  return row;
}
