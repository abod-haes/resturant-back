import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const EXPO_TOKEN_PATTERN = /^(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]{10,256}\]$/;
export const MAX_ACTIVE_DEVICES = 5;

export function validExpoPushToken(token: string): boolean {
  return token.length <= 300 && EXPO_TOKEN_PATTERN.test(token);
}
export function pushTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
export function sealPushToken(token: string, key: string): string {
  if (!validExpoPushToken(token)) throw new Error("Invalid Expo Push Token");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function openPushToken(box: string, key: string): string {
  const parts = box.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Push credential format error");
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  if (iv.length !== 12 || tag.length !== 16) throw new Error("Push credential format error");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()])
    .toString("utf8");
  if (!validExpoPushToken(plain)) throw new Error("Push credential content error");
  return plain;
}
