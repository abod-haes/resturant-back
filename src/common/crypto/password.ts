import { randomBytes, scrypt as callbackScrypt, timingSafeEqual } from "node:crypto";
const COST = 32768;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    callbackScrypt(password, salt, KEY_LENGTH, {
      N: COST,
      r: BLOCK_SIZE,
      p: PARALLELISM,
      maxmem: MAX_MEMORY,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 128) {
    throw new Error("Password must be 12–128 characters long");
  }
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return ["scrypt", String(COST), String(BLOCK_SIZE), String(PARALLELISM), salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt" ||
    parts[1] !== String(COST) || parts[2] !== String(BLOCK_SIZE) || parts[3] !== String(PARALLELISM)) {
    return false;
  }
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected);
}
