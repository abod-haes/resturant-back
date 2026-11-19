import { createHash } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import type { Kysely, Transaction } from "kysely";
import type { DatabaseTables } from "../../database/database.types";
import { requireSessionTable } from "../qr/active-table";
import { requireOperationalEntitlements } from "../subscription/operational-entitlement";
import { effectiveCallSettings } from "./call-settings";

type Db = Kysely<DatabaseTables> | Transaction<DatabaseTables>;
export const VISIT_IDLE_MS = 4 * 60 * 60 * 1000;
export const CALL_COOLDOWN_MS = 10 * 1000;
export const MAX_ACTIVE_VISITS_PER_TABLE = 200;

export function visitHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
export function validVisitToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}
export async function requireLiveVisit(db: Db, token: string) {
  if (!validVisitToken(token)) {
    throw new UnauthorizedException({ code: "SESSION_EXPIRED", message: "Visit session not found" });
  }
  const session = await db.selectFrom("visit_sessions").selectAll()
    .where("token_hash", "=", visitHash(token)).executeTakeFirst();
  if (!session || session.revoked_at || session.expires_at <= new Date()) {
    throw new UnauthorizedException({ code: "SESSION_EXPIRED", message: "Visit session expired" });
  }
  const table = await requireSessionTable(db, session.credential_id, session.table_id);
  if (table.version !== session.credential_version ||
    table.branch_id !== session.branch_id || table.restaurant_id !== session.restaurant_id) {
    throw new UnauthorizedException({ code: "SESSION_EXPIRED", message: "Visit credential changed" });
  }
  const entitlements = await requireOperationalEntitlements(db, session.restaurant_id, "menu");
  const settings = await effectiveCallSettings(db, session.restaurant_id, session.branch_id);
  return { session, table, entitlements, settings };
}
