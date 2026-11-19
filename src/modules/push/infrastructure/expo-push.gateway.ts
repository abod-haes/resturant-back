import { Inject, Injectable } from "@nestjs/common";
import { RUNTIME_CONFIG, type RuntimeConfig } from "../../../common/config/runtime-config";
import type { CallType } from "../../../database/database.types";

export const PUSH_GATEWAY = Symbol("PUSH_GATEWAY");

export interface PushCallMessage {
  callId: string;
  branchId: string;
  tableId: string;
  tableLabel: string;
  type: CallType;
}
export type PushTicket =
  | { ok: true; id: string }
  | { ok: false; errorCode: string; retryable: boolean };
export type PushReceipt = { status: "ok" } | { status: "error"; errorCode: string };
export interface PushGateway {
  send(token: string, message: PushCallMessage): Promise<PushTicket>;
  receipts(ids: readonly string[]): Promise<Record<string, PushReceipt>>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function code(value: unknown): string {
  if (typeof value !== "string") return "PROVIDER_ERROR";
  return /^[A-Za-z0-9_]{1,64}$/.test(value) ? value : "PROVIDER_ERROR";
}
function readError(data: Record<string, unknown>): string {
  return isRecord(data.details) ? code(data.details.error) : "PROVIDER_ERROR";
}
const RETRYABLE_PROVIDER_CODES = new Set(["MessageRateExceeded", "TOO_MANY_REQUESTS", "PUSH_TOO_MANY_EXPERIENCE_IDS"]);

@Injectable()
export class ExpoPushGateway implements PushGateway {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  private async post(path: "send" | "getReceipts", body: unknown): Promise<unknown> {
    const headers: Record<string, string> = { "Content-Type": "application/json", "Accept": "application/json" };
    if (this.config.expoPushAccessToken) headers.Authorization = "Bearer " + this.config.expoPushAccessToken;
    // Hardcoded official Expo endpoint: untrusted clients never provide URLs.
    const response = await fetch("https://exp.host/--/api/v2/push/" + path, {
      method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
    });
    if (response.status === 429 || response.status >= 500) throw new Error("EXPO_TEMPORARY");
    if (!response.ok) throw new Error("EXPO_HTTP_" + response.status);
    return response.json() as Promise<unknown>;
  }

  async send(token: string, message: PushCallMessage): Promise<PushTicket> {
    try {
      const payload = {
        to: token, priority: "high", sound: "default",
        channelId: message.type === "waiter" ? "waiter_calls" : "hookah_calls",
        title: message.type === "waiter" ? "استدعاء نادل" : "استدعاء أركيلة",
        body: "طلب جديد من " + message.tableLabel,
        ttl: 120,
        data: { eventType: "call.created", callId: message.callId,
          branchId: message.branchId, tableId: message.tableId, type: message.type },
      };
      const data = await this.post("send", payload);
      if (!isRecord(data) || !isRecord(data.data)) return { ok: false, errorCode: "BAD_TICKET", retryable: true };
      const ticket = data.data;
      if (ticket.status === "ok" && typeof ticket.id === "string" && ticket.id.length > 0 && ticket.id.length <= 128) {
        return { ok: true, id: ticket.id };
      }
      const errorCode = readError(ticket);
      return { ok: false, errorCode, retryable: RETRYABLE_PROVIDER_CODES.has(errorCode) };
    } catch (error: unknown) {
      const errorCode = error instanceof Error && /^EXPO_HTTP_\d{3}$/.test(error.message)
        ? error.message : "EXPO_TEMPORARY";
      return { ok: false, errorCode, retryable: errorCode === "EXPO_TEMPORARY" };
    }
  }

  async receipts(ids: readonly string[]): Promise<Record<string, PushReceipt>> {
    const json = await this.post("getReceipts", { ids });
    if (!isRecord(json) || !isRecord(json.data)) throw new Error("EXPO_BAD_RECEIPT_RESPONSE");
    const result: Record<string, PushReceipt> = {};
    for (const id of ids) {
      const item = json.data[id];
      if (!isRecord(item)) continue; // Expo may not have prepared the receipt yet.
      if (item.status === "ok") result[id] = { status: "ok" };
      else if (item.status === "error") result[id] = { status: "error", errorCode: readError(item) };
    }
    return result;
  }
}
