import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

export interface RuntimeConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly port: number;
  readonly databaseUrl: string;
  readonly databaseConnectTimeoutMs: number;
  readonly corsOrigins: readonly string[];
  readonly mediaAllowedOrigins: readonly string[];
  readonly mediaStorage: Readonly<{
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint: string | null;
    forcePathStyle: boolean;
    publicOrigin: string;
  }> | null;
  readonly qrEncryptionKey: string | null;
  readonly customerAppOrigin: string | null;
  readonly authAccessSecret: string;
  readonly pushTokenEncryptionKey: string | null;
  readonly pushDispatchEnabled: boolean;
  readonly expoPushAccessToken: string | null;
}

export const RUNTIME_CONFIG = Symbol("RUNTIME_CONFIG");

function positiveInteger(value: string, label: string, maximum: number): number {
  if (!/^[0-9]+$/.test(value)) throw new Error(label + " must be a positive integer");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new Error(label + " must be between 1 and " + maximum);
  }
  return number;
}

export function parseRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  if (nodeEnv !== "development" && nodeEnv !== "test" && nodeEnv !== "production") {
    throw new Error("NODE_ENV must be development, test, or production");
  }

  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL");
  }
  if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol) || !parsedUrl.hostname || parsedUrl.pathname === "/") {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL with host and database name");
  }

  const corsOrigins = (env.CORS_ORIGINS ?? "")
    .split(",").map((origin) => origin.trim()).filter(Boolean);
  if (corsOrigins.includes("*") && corsOrigins.length !== 1) {
    throw new Error("CORS_ORIGINS wildcard must be used alone");
  }
  for (const origin of corsOrigins) {
    if (origin === "*") continue;
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new Error("CORS_ORIGINS must contain valid HTTP(S) origins");
    }
    if (!["http:", "https:"].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin) {
      throw new Error("CORS_ORIGINS must contain origins without paths");
    }
  }

  const mediaAllowedOrigins = (env.MEDIA_ALLOWED_ORIGINS ?? "")
    .split(",").map((origin) => origin.trim()).filter(Boolean);
  for (const origin of mediaAllowedOrigins) {
    let parsed: URL;
    try { parsed = new URL(origin); }
    catch { throw new Error("MEDIA_ALLOWED_ORIGINS must contain valid HTTPS origins"); }
    if (parsed.protocol !== "https:" || parsed.origin !== origin || parsed.username || parsed.password) {
      throw new Error("MEDIA_ALLOWED_ORIGINS must contain exact HTTPS origins without paths");
    }
  }

  const mediaKeys = [
    env.MEDIA_S3_BUCKET?.trim() ?? "", env.MEDIA_S3_REGION?.trim() ?? "",
    env.MEDIA_S3_ACCESS_KEY_ID?.trim() ?? "", env.MEDIA_S3_SECRET_ACCESS_KEY?.trim() ?? "",
    env.MEDIA_PUBLIC_ORIGIN?.trim() ?? "",
  ];
  const configured = mediaKeys.some(Boolean) || Boolean(env.MEDIA_S3_ENDPOINT?.trim());
  if (configured && mediaKeys.some(value => !value)) {
    throw new Error("MEDIA_S3_BUCKET, MEDIA_S3_REGION, MEDIA_S3_ACCESS_KEY_ID, MEDIA_S3_SECRET_ACCESS_KEY and MEDIA_PUBLIC_ORIGIN must be configured together");
  }
  const mediaEndpoint = env.MEDIA_S3_ENDPOINT?.trim() || null;
  if (mediaEndpoint) {
    try {
      const parsed = new URL(mediaEndpoint);
      if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search
        || parsed.hash || parsed.pathname !== "/" || parsed.origin !== mediaEndpoint.replace(/\/$/, "")) {
        throw new Error("invalid S3 endpoint");
      }
    } catch { throw new Error("MEDIA_S3_ENDPOINT must be a valid HTTP(S) origin"); }
    if (nodeEnv === "production" && !mediaEndpoint.startsWith("https://")) {
      throw new Error("MEDIA_S3_ENDPOINT must use HTTPS in production");
    }
  }
  const mediaPublicOrigin = mediaKeys[4];
  if (mediaPublicOrigin) {
    let url: URL;
    try { url = new URL(mediaPublicOrigin); }
    catch { throw new Error("MEDIA_PUBLIC_ORIGIN must be an HTTPS origin"); }
    if (url.protocol !== "https:" || url.origin !== mediaPublicOrigin
      || url.username || url.password || url.search || url.hash) {
      throw new Error("MEDIA_PUBLIC_ORIGIN must be an exact HTTPS origin");
    }
  }
  const forcePathStyle = (env.MEDIA_S3_FORCE_PATH_STYLE ?? "false").trim();
  if (forcePathStyle !== "true" && forcePathStyle !== "false") {
    throw new Error("MEDIA_S3_FORCE_PATH_STYLE must be true or false");
  }
  const mediaStorage = configured ? Object.freeze({
    bucket: mediaKeys[0], region: mediaKeys[1], accessKeyId: mediaKeys[2],
    secretAccessKey: mediaKeys[3], endpoint: mediaEndpoint,
    forcePathStyle: forcePathStyle === "true", publicOrigin: mediaPublicOrigin,
  }) : null;

  const qrEncryptionKey = env.QR_TOKEN_ENCRYPTION_KEY?.trim() || null;
  if (qrEncryptionKey !== null && !/^[0-9a-fA-F]{64}$/.test(qrEncryptionKey)) {
    throw new Error("QR_TOKEN_ENCRYPTION_KEY must be a 32-byte (64 hex character) secret");
  }
  const customerAppOrigin = env.CUSTOMER_APP_ORIGIN?.trim() || null;
  if (customerAppOrigin) {
    let url: URL;
    try { url = new URL(customerAppOrigin); } catch {
      throw new Error("CUSTOMER_APP_ORIGIN must be a valid HTTPS origin");
    }
    if (url.protocol !== "https:" || url.origin !== customerAppOrigin
      || url.username || url.password) {
      throw new Error("CUSTOMER_APP_ORIGIN must be a single HTTPS origin without path");
    }
  }

  const pushTokenEncryptionKey = env.PUSH_TOKEN_ENCRYPTION_KEY?.trim() || null;
  if (pushTokenEncryptionKey && !/^[0-9a-fA-F]{64}$/.test(pushTokenEncryptionKey)) {
    throw new Error("PUSH_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex characters)");
  }
  const pushDispatchFlag = env.PUSH_DISPATCH_ENABLED?.trim() || "false";
  if (!["true", "false"].includes(pushDispatchFlag)) {
    throw new Error("PUSH_DISPATCH_ENABLED must be true or false");
  }
  const pushDispatchEnabled = pushDispatchFlag === "true";
  if (pushDispatchEnabled && !pushTokenEncryptionKey) {
    throw new Error("PUSH_TOKEN_ENCRYPTION_KEY is required when push worker is enabled");
  }
  const expoPushAccessToken = env.EXPO_PUSH_ACCESS_TOKEN?.trim() || null;

  const authAccessSecret = env.AUTH_ACCESS_SECRET ?? "";
  if (Buffer.byteLength(authAccessSecret, "utf8") < 32) {
    throw new Error("AUTH_ACCESS_SECRET must contain at least 32 bytes of secret entropy");
  }

  return Object.freeze({
    nodeEnv,
    port: positiveInteger(env.PORT ?? "3000", "PORT", 65535),
    databaseUrl,
    databaseConnectTimeoutMs: positiveInteger(env.DB_CONNECT_TIMEOUT_MS ?? "2000", "DB_CONNECT_TIMEOUT_MS", 60000),
    corsOrigins: Object.freeze(corsOrigins),
    mediaAllowedOrigins: Object.freeze(mediaAllowedOrigins),
    mediaStorage,
    qrEncryptionKey,
    customerAppOrigin,
    authAccessSecret,
    pushTokenEncryptionKey,
    pushDispatchEnabled,
    expoPushAccessToken,
  });
}

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [{ provide: RUNTIME_CONFIG, useFactory: () => parseRuntimeConfig(process.env) }],
  exports: [RUNTIME_CONFIG],
})
export class RuntimeConfigModule {}
