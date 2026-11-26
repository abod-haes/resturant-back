import { decodeKeysetCursor, encodeKeysetCursor, decodeDisplayCursor, encodeDisplayCursor } from "../../src/common/pagination/keyset";
import { verifyMediaUrls } from "../../src/modules/menu/application/menu-media.policy";
import { parseRuntimeConfig } from "../../src/common/config/runtime-config";

const configEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://restaurant:test@localhost:5432/restaurant",
  AUTH_ACCESS_SECRET: "test-only-randomized-secret-for-unit-testing-2026",
};

describe("Branch menu boundary policies", () => {
  it("round-trips bounded opaque pagination cursors", () => {
    const value = { timestamp: "2026-11-19T19:00:00.000000Z", id: "9c5b5fb3-c17b-4c4a-aaf1-95959ebdcc29" };
    expect(decodeKeysetCursor(encodeKeysetCursor(value))).toEqual(value);
  });
  it("orders menu cursors by sortOrder and validates their shape", () => {
    const cursor = { sortOrder: 45, id: "9c5b5fb3-c17b-4c4a-aaf1-95959ebdcc29" };
    expect(decodeDisplayCursor(encodeDisplayCursor(cursor))).toEqual(cursor);
    expect(() => decodeDisplayCursor(encodeKeysetCursor({
      timestamp: "2026-11-19T19:00:00.000000Z", id: cursor.id,
    }))).toThrow();
  });
  it.each(["invalid", "!!!", Buffer.from(JSON.stringify({ id: "wrong" })).toString("base64url")])
    ("rejects malformed cursors", (value) => {
      expect(() => decodeKeysetCursor(value)).toThrow("Invalid pagination cursor");
    });
  it("denies URLs from unspecified media origins and requires HTTPS", () => {
    expect(() => verifyMediaUrls([{ url: "https://other.example.test/img.webp" }], ["https://images.example.test"]))
      .toThrow("Product image host is not approved");
    expect(() => verifyMediaUrls([{ url: "http://images.example.test/img.webp" }], ["https://images.example.test"]))
      .toThrow();
    expect(() => verifyMediaUrls([{ url: "https://images.example.test/img.webp?token=secret" }], ["https://images.example.test"]))
      .toThrow();
    expect(() => verifyMediaUrls([{ url: "https://images.example.test/img.webp" }], []))
      .toThrow();
    expect(() => verifyMediaUrls([{ url: "https://images.example.test/img.webp" }], ["https://images.example.test"]))
      .not.toThrow();
  });
  it("accepts managed image identifiers and rejects ambiguous input", () => {
    const mediaId = "9c5b5fb3-c17b-4c4a-aaf1-95959ebdcc29";
    expect(() => verifyMediaUrls([{ mediaId }], [])).not.toThrow();
    expect(() => verifyMediaUrls([{}], [])).toThrow();
    expect(() => verifyMediaUrls([{ mediaId, url: "https://images.example.test/a.webp" }], ["https://images.example.test"])).toThrow();
  });
  it("validates a configured HTTPS CDN allowlist at startup", () => {
    expect(parseRuntimeConfig({ ...configEnv, MEDIA_ALLOWED_ORIGINS: "https://images.example.test" }).mediaAllowedOrigins)
      .toEqual(["https://images.example.test"]);
    expect(() => parseRuntimeConfig({ ...configEnv, MEDIA_ALLOWED_ORIGINS: "http://images.example.test" }))
      .toThrow("MEDIA_ALLOWED_ORIGINS");
    expect(() => parseRuntimeConfig({ ...configEnv, MEDIA_ALLOWED_ORIGINS: "https://images.example.test/path" }))
      .toThrow("MEDIA_ALLOWED_ORIGINS");
  });
});
