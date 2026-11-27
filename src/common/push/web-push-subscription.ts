import { createCipheriv, createDecipheriv, randomBytes, ECDH } from "node:crypto";
import { pushTokenHash } from "./push-token";

export interface WebSubscription {
 endpoint: string;
 keys: { p256dh: string; auth: string };
 expirationTime: number | null;
}
export function validateWebSubscription(value: WebSubscription): boolean {
 try {
  const url = new URL(value.endpoint);
  const host = url.hostname;
  // Reject ambiguous endpoint syntax before handing the URL to the provider client.
  if (/[\x00-\x20\x7f\\]/.test(value.endpoint) || url.pathname === "/" || url.pathname.startsWith("//")) return false;
  const allowed = host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" || host === "web.push.apple.com" || host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com");
  if (!allowed || url.protocol !== "https:" || url.port || url.username || url.password || url.hash || url.href !== value.endpoint || value.endpoint.length > 2048) return false;
  if (!/^[A-Za-z0-9_-]{87}$/.test(value.keys.p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(value.keys.auth)) return false;
  const publicKey = Buffer.from(value.keys.p256dh, "base64url");
  const authKey = Buffer.from(value.keys.auth, "base64url");
  if (publicKey.length !== 65 || publicKey[0] !== 4 || authKey.length !== 16 || publicKey.toString("base64url") !== value.keys.p256dh || authKey.toString("base64url") !== value.keys.auth) return false;
  ECDH.convertKey(publicKey, "prime256v1");
  return value.expirationTime === null || (Number.isSafeInteger(value.expirationTime) && value.expirationTime > Date.now() && value.expirationTime <= 8640000000000000);
 } catch { return false; }
}
export function webEndpointHash(endpoint: string): string { return pushTokenHash("web_push:" + endpoint); }
export function sealWebSubscription(value: WebSubscription, key: string): string {
 if (!validateWebSubscription(value)) throw new Error("Invalid web subscription");
 if (!/^[0-9a-fA-F]{64}$/.test(key)) throw new Error("Invalid encryption key");
 const iv = randomBytes(12);
 const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
 cipher.setAAD(Buffer.from("web_push:v1"));
 const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
 return ["web1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function openWebSubscription(box: string, key: string): WebSubscription {
 if (!/^[0-9a-fA-F]{64}$/.test(key) || box.length > 8192) throw new Error("Invalid web credential");
 const [version, iv, tag, payload, extra] = box.split(".");
 if (version !== "web1" || !iv || !tag || !payload || extra !== undefined) throw new Error("Invalid web credential");
 if (Buffer.from(iv,"base64url").length !== 12 || Buffer.from(tag,"base64url").length !== 16) throw new Error("Invalid web credential");
 const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), Buffer.from(iv, "base64url"));
 decipher.setAAD(Buffer.from("web_push:v1"));
 decipher.setAuthTag(Buffer.from(tag, "base64url"));
 const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload, "base64url")), decipher.final()]).toString("utf8")) as WebSubscription;
 if (!validateWebSubscription(value)) throw new Error("Invalid or expired web subscription");
 return value;
}
