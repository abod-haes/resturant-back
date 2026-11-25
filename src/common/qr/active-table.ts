import { NotFoundException } from "@nestjs/common";
import type { Kysely, Transaction } from "kysely";
import type { DatabaseTables } from "../../database/database.types";
import { hashQrToken, isValidQrToken } from "./qr-token";

export type QueryDatabase = Kysely<DatabaseTables> | Transaction<DatabaseTables>;

/** Validates current credential and all table hierarchy flags. QR is not proof of physical presence. */
export async function requireActiveTableQr(db: QueryDatabase, token: string) {
  if (!isValidQrToken(token)) throw new NotFoundException({ code: "QR_REVOKED", message: "QR unavailable" });
  const row = await db.selectFrom("qr_credentials")
    .innerJoin("restaurant_tables", "restaurant_tables.id", "qr_credentials.table_id")
    .innerJoin("areas", "areas.id", "restaurant_tables.area_id")
    .innerJoin("floors", "floors.id", "areas.floor_id")
    .innerJoin("branches", "branches.id", "restaurant_tables.branch_id")
    .innerJoin("restaurants", "restaurants.id", "restaurant_tables.restaurant_id")
    .select([
      "qr_credentials.id as credential_id", "qr_credentials.version",
      "restaurant_tables.id as table_id", "restaurant_tables.label as table_label",
      "restaurant_tables.qr_version", "restaurant_tables.calls_enabled", "restaurant_tables.qr_enabled",
      "restaurant_tables.is_active as table_active", "restaurant_tables.archived_at as table_archived",
      "areas.is_active as area_active", "areas.archived_at as area_archived",
      "floors.is_active as floor_active", "floors.archived_at as floor_archived",
      "branches.id as branch_id", "branches.name as branch_name", "branches.slug",
      "branches.is_active as branch_active", "restaurants.id as restaurant_id",
      "restaurants.name as restaurant_name", "restaurants.subdomain as restaurant_subdomain", "restaurants.is_active as restaurant_active",
    ])
    .where("qr_credentials.token_hash", "=", hashQrToken(token))
    .where("qr_credentials.revoked_at", "is", null).executeTakeFirst();
  if (!row || row.version !== row.qr_version || !row.table_active || !row.qr_enabled
    || row.table_archived || !row.area_active || row.area_archived || !row.floor_active
    || row.floor_archived || !row.branch_active || !row.restaurant_active) {
    throw new NotFoundException({ code: "QR_REVOKED", message: "QR unavailable" });
  }
  return row;
}

/** Sessions contain only credential ID and version; do not need plaintext QR tokens to validate. */
export async function requireSessionTable(db: QueryDatabase, credentialId: string, tableId: string) {
  const row = await db.selectFrom("qr_credentials")
    .innerJoin("restaurant_tables", "restaurant_tables.id", "qr_credentials.table_id")
    .innerJoin("areas", "areas.id", "restaurant_tables.area_id")
    .innerJoin("floors", "floors.id", "areas.floor_id")
    .innerJoin("branches", "branches.id", "restaurant_tables.branch_id")
    .innerJoin("restaurants", "restaurants.id", "restaurant_tables.restaurant_id")
    .select([
      "restaurant_tables.id as table_id", "restaurant_tables.branch_id", "restaurant_tables.restaurant_id",
      "restaurant_tables.qr_version", "restaurant_tables.calls_enabled", "restaurant_tables.qr_enabled",
      "restaurant_tables.is_active as table_active", "restaurant_tables.archived_at as table_archived",
      "qr_credentials.id as credential_id", "qr_credentials.version",
      "areas.is_active as area_active", "areas.archived_at as area_archived",
      "floors.is_active as floor_active", "floors.archived_at as floor_archived",
      "branches.is_active as branch_active", "restaurants.is_active as restaurant_active",
    ])
    .where("qr_credentials.id", "=", credentialId).where("qr_credentials.table_id", "=", tableId)
    .where("qr_credentials.revoked_at", "is", null).executeTakeFirst();
  if (!row || row.version !== row.qr_version || !row.table_active || !row.qr_enabled
    || row.table_archived || !row.area_active || row.area_archived || !row.floor_active
    || row.floor_archived || !row.branch_active || !row.restaurant_active) {
    throw new NotFoundException({ code: "QR_REVOKED", message: "QR unavailable" });
  }
  return row;
}
