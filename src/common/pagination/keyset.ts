import { BadRequestException } from "@nestjs/common";

export interface KeysetCursor { timestamp: string; id: string }
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_MICROS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function decodeKeysetCursor(value: string): KeysetCursor {
  try {
    if (!/^[A-Za-z0-9_-]{1,500}$/.test(value)) throw new Error("Invalid cursor");
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof decoded !== "object" || !decoded || Array.isArray(decoded)
      || !("timestamp" in decoded) || !("id" in decoded)
      || typeof decoded.timestamp !== "string" || typeof decoded.id !== "string"
      || !UTC_MICROS.test(decoded.timestamp) || !UUID_V4.test(decoded.id)
      || !Number.isFinite(Date.parse(decoded.timestamp))) throw new Error("Invalid cursor");
    return { timestamp: decoded.timestamp, id: decoded.id };
  } catch {
    throw new BadRequestException("Invalid pagination cursor");
  }
}
export function encodeKeysetCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
