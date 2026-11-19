import { Injectable, NotFoundException, TooManyRequestsException, UnauthorizedException } from "@nestjs/common";
import { sql } from "kysely";
import { DatabaseService } from "../../../database/database.service";
import { generateOpaqueToken, hashOpaqueToken, isOpaqueToken } from "../../../common/crypto/opaque-token";
import { activeQrTable } from "../../../common/qr/active-table";
import { requireOperationalEntitlements } from "../../../common/subscription/operational-entitlement";
import {
  MAX_VISITS_PER_TABLE_PER_MINUTE, visitExpiresAt,
} from "../../../common/visits/visit-policy";
import type { VisitSessionDto, VisitStateDto } from "../presentation/visit.dto";

export function availableCalls(flags: { waiter_calls: boolean; hookah_calls: boolean },
  tableCallsEnabled: boolean): ("waiter" | "hookah")[] {
  if (!tableCallsEnabled) return [];
  const types: ("waiter" | "hookah")[] = [];
  if (flags.waiter_calls) types.push("waiter");
  if (flags.hookah_calls) types.push("hookah");
  return types;
}

@Injectable()
export class VisitsService {
  constructor(private readonly database: DatabaseService) {}

  async create(qrToken: string): Promise<VisitSessionDto> {
    if (!isOpaqueToken(qrToken)) throw new NotFoundException("QR not found");
    return this.database.db.transaction().execute(async (trx) => {
      const credential = await trx.selectFrom("qr_credentials").select(["id", "table_id"])
        .where("token_hash", "=", hashOpaqueToken(qrToken))
        .where("revoked_at", "is", null).executeTakeFirst();
      if (!credential) throw new NotFoundException("QR not found");
      const tableLocator = await trx.selectFrom("restaurant_tables")
        .select("restaurant_id").where("id", "=", credential.table_id).executeTakeFirst();
      if (!tableLocator) throw new NotFoundException("QR not found");
      // Lock ordering matches QR rotation: restaurant first, then table.
      await trx.selectFrom("restaurants").select("id")
        .where("id", "=", tableLocator.restaurant_id).forUpdate().executeTakeFirstOrThrow();
      const table = await activeQrTable(trx, credential.id);
      await trx.selectFrom("restaurant_tables").select("id")
        .where("id", "=", table.table_id).forUpdate().executeTakeFirstOrThrow();
      const entitlements = await requireOperationalEntitlements(trx, table.restaurant_id, "menu");
      const now = new Date();
      const recent = await trx.selectFrom("visit_sessions")
        .select(sql<number>`count(*)::int`.as("total"))
        .where("table_id", "=", table.table_id)
        .where("created_at", ">=", new Date(now.getTime() - 60_000))
        .executeTakeFirstOrThrow();
      if (recent.total >= MAX_VISITS_PER_TABLE_PER_MINUTE) {
        throw new TooManyRequestsException({ code: "SESSION_RATE_LIMITED",
          message: "Too many QR visits started for this table" });
      }
      const token = generateOpaqueToken();
      const expiresAt = visitExpiresAt(now);
      await trx.insertInto("visit_sessions").values({
        restaurant_id: table.restaurant_id, branch_id: table.branch_id,
        table_id: table.table_id, qr_credential_id: table.credential_id,
        qr_version: table.qr_version, token_hash: hashOpaqueToken(token),
        expires_at: expiresAt, first_call_confirmed: false,
        last_activity_at: now,
      }).execute();
      return {
        sessionToken: token, expiresAt: expiresAt.toISOString(), firstCallNeedsConfirmation: true,
        availableCallTypes: availableCalls(entitlements.features, table.calls_enabled),
      };
    });
  }

  async heartbeat(sessionToken: string): Promise<VisitStateDto> {
    if (!isOpaqueToken(sessionToken)) throw new UnauthorizedException({ code: "SESSION_EXPIRED", message: "Session is invalid" });
    return this.database.db.transaction().execute(async (trx) => {
      const session = await trx.selectFrom("visit_sessions")
        .selectAll().where("token_hash", "=", hashOpaqueToken(sessionToken))
        .forUpdate().executeTakeFirst();
      const now = new Date();
      if (!session || session.expires_at <= now) {
        throw new UnauthorizedException({ code: "SESSION_EXPIRED", message: "Visit session expired" });
      }
      const table = await activeQrTable(trx, session.qr_credential_id);
      if (session.qr_version !== table.qr_version || session.table_id !== table.table_id) {
        throw new UnauthorizedException({ code: "SESSION_EXPIRED", message: "Visit session revoked" });
      }
      const entitlements = await requireOperationalEntitlements(trx, session.restaurant_id, "menu");
      const expiresAt = visitExpiresAt(now);
      await trx.updateTable("visit_sessions").set({
        last_activity_at: now, expires_at: expiresAt,
      }).where("id", "=", session.id).execute();
      return {
        expiresAt: expiresAt.toISOString(),
        firstCallNeedsConfirmation: !session.first_call_confirmed,
        availableCallTypes: availableCalls(entitlements.features, table.calls_enabled),
      };
    });
  }
}
