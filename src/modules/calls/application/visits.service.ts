import { assertPublicTenant } from "../../../common/tenancy/public-tenant";
import { Inject } from "@nestjs/common";
import { RUNTIME_CONFIG, type RuntimeConfig } from "../../../common/config/runtime-config";
import { HttpException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { DatabaseService } from "../../../database/database.service";
import { requireActiveTableQr } from "../../../common/qr/active-table";
import { requireOperationalEntitlements } from "../../../common/subscription/operational-entitlement";
import { callIsAvailable, effectiveCallSettings } from "../../../common/calls/call-settings";
import {
  MAX_ACTIVE_VISITS_PER_TABLE, requireLiveVisit, VISIT_IDLE_MS, visitHash,
} from "../../../common/calls/visit-policy";
import type { CallType } from "../../../database/database.types";
import type { CreateVisitResponseDataDto, VisitStatusDto } from "../presentation/calls.dto";

function enabledTypes(tableEnabled: boolean, settings: Awaited<ReturnType<typeof effectiveCallSettings>>,
  entitlements: Awaited<ReturnType<typeof requireOperationalEntitlements>>): CallType[] {
  const candidates: CallType[] = ["waiter", "hookah"];
  return candidates.filter(type => callIsAvailable(type, tableEnabled, settings, entitlements));
}
@Injectable()
export class VisitsService {
  constructor(private readonly database: DatabaseService, @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  async create(qrToken: string, origin?: string): Promise<CreateVisitResponseDataDto> {
    return this.database.db.transaction().execute(async trx => {
      const initial = await requireActiveTableQr(trx, qrToken);
      // Same row lock as QR rotate and call processing, serializes issuance against revocation.
      await trx.selectFrom("restaurant_tables").select("id")
        .where("id", "=", initial.table_id).forUpdate().executeTakeFirstOrThrow();
      const table = await requireActiveTableQr(trx, qrToken);
      assertPublicTenant(origin, this.config.restaurantBaseDomain, table);
      if (table.credential_id !== initial.credential_id) throw new NotFoundException("QR changed");
      const entitlements = await requireOperationalEntitlements(trx, table.restaurant_id, "menu");
      const settings = await effectiveCallSettings(trx, table.restaurant_id, table.branch_id);
      const active = await trx.selectFrom("visit_sessions")
        .select(sql<number>`count(*)::int`.as("count"))
        .where("table_id", "=", table.table_id).where("revoked_at", "is", null)
        .where("expires_at", ">", new Date()).executeTakeFirstOrThrow();
      if (active.count >= MAX_ACTIVE_VISITS_PER_TABLE) {
        throw new HttpException({ code: "SESSION_CAP_REACHED", message: "Too many active visits" }, 429);
      }
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + VISIT_IDLE_MS);
      await trx.insertInto("visit_sessions").values({
        restaurant_id: table.restaurant_id, branch_id: table.branch_id, table_id: table.table_id,
        credential_id: table.credential_id, credential_version: table.version, token_hash: visitHash(token),
        expires_at: expiresAt, revoked_at: null,
      }).execute();
      return {
        sessionToken: token, expiresAt: expiresAt.toISOString(),
        firstCallNeedsConfirmation: true,
        availableCallTypes: enabledTypes(table.calls_enabled, settings, entitlements),
      };
    });
  }

  async status(token: string, origin?: string): Promise<VisitStatusDto> {
    return this.database.db.transaction().execute(async trx => {
      const { session, table, entitlements, settings } = await requireLiveVisit(trx, token, origin, this.config.restaurantBaseDomain);
      const expiry = new Date(Date.now() + VISIT_IDLE_MS);
      await trx.updateTable("visit_sessions")
        .set({ last_activity_at: new Date(), expires_at: expiry })
        .where("id", "=", session.id).execute();
      return {
        expiresAt: expiry.toISOString(), firstCallNeedsConfirmation: !session.first_call_confirmed,
        availableCallTypes: enabledTypes(table.calls_enabled, settings, entitlements),
      };
    });
  }
}
