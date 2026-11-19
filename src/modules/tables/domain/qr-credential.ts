import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export function generateQrToken(): string {
  return randomBytes(32).toString("base64url");
}
export function hashQrToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
export function isValidQrToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
export function encryptQrToken(token: string, keyHex: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), nonce);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
export function decryptQrToken(box: string, keyHex: string): string {
  const parts = box.split(".");
  if (parts.length !== 3) throw new Error("Invalid stored QR credential");
  const [nonceText, tagText, cipherText] = parts;
  const nonce = Buffer.from(nonceText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  if (nonce.length !== 12 || tag.length !== 16) throw new Error("Invalid stored QR credential");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), nonce);
  decipher.setAuthTag(tag);
  const token = Buffer.concat([decipher.update(Buffer.from(cipherText, "base64url")), decipher.final()]).toString("utf8");
  if (!isValidQrToken(token)) throw new Error("Invalid stored QR credential");
  return token;
}
export function customerQrUrl(origin: string, token: string): string {
  if (!isValidQrToken(token)) throw new Error("Invalid QR token");
  return origin + "/t/" + token;
}
