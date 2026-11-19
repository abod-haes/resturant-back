import { createHash, randomBytes } from "node:crypto";

/** Non-guessable bearer capability: 256 bits of cryptographic randomness, base64url. */
export function generateOpaqueToken(): string { return randomBytes(32).toString("base64url"); }
export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
export function isOpaqueToken(token: string): boolean { return /^[A-Za-z0-9_-]{43}$/.test(token); }
