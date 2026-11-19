import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

export interface RuntimeConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly port: number;
  readonly databaseUrl: string;
  readonly databaseConnectTimeoutMs: number;
  readonly corsOrigins: readonly string[];
  readonly mediaAllowedOrigins: readonly string[];
  readonly authAccessSecret: string;
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
  for (const origin of corsOrigins) {
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
    authAccessSecret,
  });
}

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [{ provide: RUNTIME_CONFIG, useFactory: () => parseRuntimeConfig(process.env) }],
  exports: [RUNTIME_CONFIG],
})
export class RuntimeConfigModule {}
