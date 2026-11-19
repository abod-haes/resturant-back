import { parseRuntimeConfig } from "../../src/common/config/runtime-config";

const validEnv = {
  NODE_ENV: "test",
  PORT: "3000",
  DATABASE_URL: "postgresql://restaurant:test@localhost:5432/restaurant",
};

describe("parseRuntimeConfig", () => {
  it("parses validated defaults", () => {
    const config = parseRuntimeConfig(validEnv);
    expect(config.port).toBe(3000);
    expect(config.databaseConnectTimeoutMs).toBe(2000);
    expect(config.corsOrigins).toEqual([]);
  });

  it.each(["0", "-1", "65536", "abc", "1.2"])("rejects invalid PORT %s", (port) => {
    expect(() => parseRuntimeConfig({ ...validEnv, PORT: port })).toThrow("PORT");
  });

  it("rejects missing and non-Postgres database URLs", () => {
    expect(() => parseRuntimeConfig({ NODE_ENV: "test" })).toThrow("DATABASE_URL");
    expect(() => parseRuntimeConfig({ ...validEnv, DATABASE_URL: "https://example.com/db" })).toThrow("DATABASE_URL");
  });

  it("allows explicit origins but rejects paths and wildcards", () => {
    expect(parseRuntimeConfig({ ...validEnv, CORS_ORIGINS: "https://dash.example.com,http://localhost:5173" }).corsOrigins)
      .toEqual(["https://dash.example.com", "http://localhost:5173"]);
    expect(() => parseRuntimeConfig({ ...validEnv, CORS_ORIGINS: "*" })).toThrow("CORS_ORIGINS");
    expect(() => parseRuntimeConfig({ ...validEnv, CORS_ORIGINS: "https://example.com/path" })).toThrow("CORS_ORIGINS");
  });

  it("rejects bad database connection timeouts", () => {
    expect(() => parseRuntimeConfig({ ...validEnv, DB_CONNECT_TIMEOUT_MS: "0" })).toThrow("DB_CONNECT_TIMEOUT_MS");
  });
});
