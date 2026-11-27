import { ForbiddenException, Inject, Injectable, Logger } from "@nestjs/common";
import { sql } from "kysely";
import { DatabaseService } from "../../../database/database.service";
import { RUNTIME_CONFIG, type RuntimeConfig } from "../../../common/config/runtime-config";
import { openPushToken } from "../../../common/push/push-token";
import { requireOperationalEntitlements } from "../../../common/subscription/operational-entitlement";
import { PUSH_GATEWAY, type PushGateway, type PushCallMessage, type PushTicket } from "../infrastructure/expo-push.gateway";

const MAX_PUSH_AGE_MS = 2 * 60 * 1000;
const LEASE_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;
const BATCH_LIMIT = 15;
const RECEIPT_POLL_DELAY_MS = 60 * 1000;
const RECEIPT_EXPIRE_MS = 24 * 60 * 60 * 1000;

export function pushRetryDelay(attempts: number): number {
  return Math.min(120, Math.pow(2, Math.max(0, attempts - 1)) * 2) * 1000;
}

@Injectable()
export class PushDispatcherService {
  private readonly logger = new Logger(PushDispatcherService.name);
  constructor(
    private readonly database: DatabaseService,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    @Inject(PUSH_GATEWAY) private readonly gateway: PushGateway,
  ) {}

  /** Expand recipient rows to per-device attempts while the outbox row is locked. */
  async expand(): Promise<number> {
    const now = new Date();
    return this.database.db.transaction().execute(async trx => {
      const rows = await trx.selectFrom("call_outbox")
        .innerJoin("service_calls", "service_calls.id", "call_outbox.call_id")
        .select(["call_outbox.id", "call_outbox.recipient_user_id", "service_calls.branch_id",
          "service_calls.restaurant_id", "service_calls.created_at", "service_calls.type"])
        .where("call_outbox.state", "=", "pending")
        .where("call_outbox.next_attempt_at", "<=", now)
        .orderBy("call_outbox.created_at", "asc")
        .limit(BATCH_LIMIT).forUpdate("call_outbox").skipLocked().execute();
      for (const row of rows) {
        const expired = now.getTime() - row.created_at.getTime() >= MAX_PUSH_AGE_MS;
        const staff = await trx.selectFrom("users")
          .innerJoin("branches", "branches.id", "users.branch_id")
          .select("users.id")
          .where("users.id", "=", row.recipient_user_id)
          .where("users.role", "=", "EMPLOYEE")
          .where("users.department", "=", row.type)
          .where("users.restaurant_id", "=", row.restaurant_id)
          .where("users.is_active", "=", true).where("users.archived_at", "is", null)
          .where("branches.is_active", "=", true)
          .where("branches.id", "=", row.branch_id)
          .where("branches.restaurant_id", "=", row.restaurant_id)
          .executeTakeFirst();
        const shift = staff && await trx.selectFrom("employee_shifts").select("id")
          .where("user_id", "=", row.recipient_user_id)
          .where("branch_id", "=", row.branch_id)
          .where("ended_at", "is", null).where("auto_end_at", ">", now)
          .executeTakeFirst();
        if (expired || !staff || !shift) {
          await trx.updateTable("call_outbox").set({ state: "failed" }).where("id", "=", row.id).execute();
          continue;
        }
        // Missing/expired subscription prevents provider side effects.
        try {
          await requireOperationalEntitlements(trx, row.restaurant_id,
            row.type === "waiter" ? "waiter_calls" : "hookah_calls");
        } catch (error: unknown) {
          if (!(error instanceof ForbiddenException)) throw error;
          await trx.updateTable("call_outbox").set({ state: "failed" }).where("id", "=", row.id).execute();
          continue;
        }
        const expoDevices = await trx.selectFrom("employee_push_devices").select(["id","channel"])
          .where("user_id", "=", row.recipient_user_id).where("channel","=","expo")
          .where("is_active", "=", true).orderBy("last_seen_at","desc").limit(5).execute();
        const webDevices = this.config.webPush ? await trx.selectFrom("employee_push_devices")
          .innerJoin("auth_sessions","auth_sessions.id","employee_push_devices.session_id")
          .select(["employee_push_devices.id","employee_push_devices.channel"])
          .where("employee_push_devices.user_id","=",row.recipient_user_id)
          .whereRef("auth_sessions.user_id","=","employee_push_devices.user_id")
          .where("employee_push_devices.channel","=","web_push")
          .where("employee_push_devices.is_active","=",true)
          .where("auth_sessions.revoked_at","is",null).where("auth_sessions.expires_at",">",now)
          .where(eb=>eb.or([eb("employee_push_devices.expires_at","is",null),eb("employee_push_devices.expires_at",">",now)]))
          .orderBy("employee_push_devices.last_seen_at","desc").limit(5).execute() : [];
        const devices = [...expoDevices,...webDevices];
        if (devices.length) {
          await trx.insertInto("push_deliveries")
            .values(devices.map(device => ({
              outbox_id: row.id, device_id: device.id, channel: device.channel,
              lease_until: null, ticket_id: null, receipt_checked_at: null, last_error_code: null,
            })))
            .onConflict(oc => oc.columns(["outbox_id","device_id"]).doNothing()).execute();
        }
        await trx.updateTable("call_outbox")
          .set({ next_attempt_at: new Date(now.getTime() + 30_000) })
          .where("id", "=", row.id).execute();
      }
      return rows.length;
    });
  }

  private async claim() {
    const now = new Date();
    return this.database.db.transaction().execute(async trx => {
      const row = await trx.selectFrom("push_deliveries").selectAll()
        .where("channel","=","expo").where("state", "=", "pending").where("next_attempt_at", "<=", now)
        .where(eb => eb.or([eb("lease_until", "is", null), eb("lease_until", "<", now)]))
        .orderBy("next_attempt_at", "asc").orderBy("id", "asc")
        .forUpdate().skipLocked().executeTakeFirst();
      if (!row) return null;
      return trx.updateTable("push_deliveries")
        .set({ lease_until: new Date(now.getTime() + LEASE_MS),
          attempts: row.attempts + 1 })
        .where("id", "=", row.id).returningAll().executeTakeFirstOrThrow();
    });
  }

  private async dispatchOne(): Promise<boolean> {
    const claim = await this.claim();
    if (!claim) return false;
    const record = await this.database.db.selectFrom("push_deliveries")
      .innerJoin("call_outbox", "call_outbox.id", "push_deliveries.outbox_id")
      .innerJoin("service_calls", "service_calls.id", "call_outbox.call_id")
      .innerJoin("restaurant_tables", "restaurant_tables.id", "service_calls.table_id")
      .innerJoin("employee_push_devices", "employee_push_devices.id", "push_deliveries.device_id")
      .innerJoin("users", "users.id", "call_outbox.recipient_user_id")
      .innerJoin("branches", "branches.id", "service_calls.branch_id")
      .select([
        "call_outbox.id as outbox_id", "call_outbox.recipient_user_id",
        "service_calls.id as call_id", "service_calls.branch_id", "service_calls.restaurant_id",
        "service_calls.table_id", "service_calls.type", "service_calls.created_at",
        "restaurant_tables.label", "employee_push_devices.token_box", "employee_push_devices.is_active as device_active",
        "users.is_active as employee_active", "users.archived_at as employee_archived",
        "branches.is_active as branch_active",
      ]).where("push_deliveries.id", "=", claim.id).executeTakeFirstOrThrow();
    const now = new Date();
    const stillOnShift = await this.database.db.selectFrom("employee_shifts")
      .select("id").where("user_id", "=", record.recipient_user_id)
      .where("branch_id", "=", record.branch_id).where("ended_at", "is", null)
      .where("auto_end_at", ">", now).executeTakeFirst();
    let ticket: PushTicket;
    if (!record.device_active || !record.employee_active || !record.branch_active || record.employee_archived ||
      !stillOnShift || now.getTime() - record.created_at.getTime() > MAX_PUSH_AGE_MS) {
      ticket = { ok: false, retryable: false, errorCode: "RECIPIENT_NOT_ELIGIBLE" };
    } else {
      try {
        await requireOperationalEntitlements(this.database.db, record.restaurant_id,
          record.type === "waiter" ? "waiter_calls" : "hookah_calls");
        if (!this.config.pushTokenEncryptionKey) throw new Error("Missing push token key");
        const token = openPushToken(record.token_box, this.config.pushTokenEncryptionKey);
        const message: PushCallMessage = {
          callId: record.call_id, branchId: record.branch_id, tableId: record.table_id,
          tableLabel: record.label, type: record.type,
        };
        ticket = await this.gateway.send(token, message);
      } catch (error: unknown) {
        ticket = error instanceof ForbiddenException
          ? { ok: false, retryable: false, errorCode: "SUBSCRIPTION_INACTIVE" }
          : { ok: false, retryable: true, errorCode: "SENDER_TEMPORARY" };
      }
    }
    const retry = !ticket.ok && ticket.retryable && claim.attempts < MAX_ATTEMPTS
      && now.getTime() - record.created_at.getTime() < MAX_PUSH_AGE_MS;
    const state = ticket.ok ? "accepted" as const : retry ? "pending" as const : "failed" as const;
    await this.database.db.transaction().execute(async trx => {
      const changed = await trx.updateTable("push_deliveries").set({
        state, lease_until: null,
        ticket_id: ticket.ok ? ticket.id : null,
        last_error_code: ticket.ok ? null : ticket.errorCode,
        next_attempt_at: ticket.ok ? new Date(Date.now() + RECEIPT_POLL_DELAY_MS)
          : retry ? new Date(Date.now() + pushRetryDelay(claim.attempts)) : now,
      }).where("id", "=", claim.id).where("state", "=", "pending")
        .where("attempts", "=", claim.attempts).returning("id").executeTakeFirst();
      if (!changed) return;
      const summary = await trx.selectFrom("push_deliveries")
        .select([
          sql<number>`count(*) filter (where state='accepted')::int`.as("accepted"),
          sql<number>`count(*) filter (where state='pending')::int`.as("pending"),
        ]).where("outbox_id", "=", record.outbox_id).executeTakeFirstOrThrow();
      if (summary.accepted > 0) {
        await trx.updateTable("call_outbox").set({ state: "sent" })
          .where("id", "=", record.outbox_id).execute();
      } else if (summary.pending === 0 && !retry) {
        await trx.updateTable("call_outbox").set({ state: "failed" })
          .where("id", "=", record.outbox_id).execute();
      }
    });
    if (!ticket.ok) {
      this.logger.warn(JSON.stringify({ event: "push_send_failed", code: ticket.errorCode,
        retry, deliveryId: claim.id }));
      if (ticket.errorCode === "DeviceNotRegistered") {
        await this.database.db.updateTable("employee_push_devices")
          .set({ is_active: false }).where("id", "=", claim.device_id).execute();
      }
    }
    return true;
  }

  private async checkReceipts(): Promise<number> {
    const now = new Date();
    const rows = await this.database.db.selectFrom("push_deliveries").select(["id", "ticket_id", "device_id", "created_at"])
      .where("channel","=","expo").where("state", "=", "accepted").where("receipt_status", "=", "waiting")
      .where("ticket_id", "is not", null)
      .where("next_attempt_at", "<=", now)
      .orderBy("next_attempt_at", "asc").limit(BATCH_LIMIT).execute();
    const ready = rows.filter((r): r is typeof r & { ticket_id: string } => r.ticket_id !== null);
    if (!ready.length) return 0;
    let receipts: Record<string, import("../infrastructure/expo-push.gateway").PushReceipt>;
    try {
      receipts = await this.gateway.receipts(ready.map(r => r.ticket_id));
    } catch {
      this.logger.warn(JSON.stringify({ event: "push_receipts_temporarily_unavailable" }));
      return 0;
    }
    for (const row of ready) {
      const receipt = receipts[row.ticket_id];
      const tooOld = now.getTime() - row.created_at.getTime() > RECEIPT_EXPIRE_MS;
      if (!receipt && !tooOld) {
        // Reschedule unknown receipts instead of hammering Expo on every worker tick.
        await this.database.db.updateTable("push_deliveries")
          .set({ receipt_checked_at: now,
            next_attempt_at: new Date(now.getTime() + RECEIPT_POLL_DELAY_MS) })
          .where("id", "=", row.id).where("receipt_status", "=", "waiting").execute();
        continue;
      }
      const status = receipt?.status === "ok" ? "ok" as const
        : receipt?.status === "error" ? "error" as const : "expired" as const;
      await this.database.db.updateTable("push_deliveries")
        .set({ receipt_status: status, receipt_checked_at: now,
          last_error_code: receipt?.status === "error" ? receipt.errorCode : status === "expired" ? "RECEIPT_EXPIRED" : null })
        .where("id", "=", row.id).where("receipt_status", "=", "waiting").execute();
      if (receipt?.status === "error" && receipt.errorCode === "DeviceNotRegistered") {
        await this.database.db.updateTable("employee_push_devices")
          .set({ is_active: false }).where("id", "=", row.device_id).execute();
      }
    }
    return ready.length;
  }

  /** Exactly one bounded iteration. An API server must NEVER run the dispatcher automatically. */
  async tick(): Promise<{ expanded: number; attempts: number; receipts: number }> {
    const expanded = await this.expand();
    let attempts = 0;
    for (let i = 0; i < BATCH_LIMIT; i++) {
      const sent = await this.dispatchOne();
      if (!sent) break;
      attempts++;
    }
    const receipts = await this.checkReceipts();
    return { expanded, attempts, receipts };
  }
}
