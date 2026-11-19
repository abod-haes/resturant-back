import { openPushToken, pushTokenHash, sealPushToken, validExpoPushToken } from "../../src/common/push/push-token";
import { pushRetryDelay } from "../../src/modules/push/application/push-dispatcher.service";
import { parseRuntimeConfig } from "../../src/common/config/runtime-config";

const TOKEN = "ExpoPushToken[abcdefghijklmnopqrst1234567890]";
const KEY = "345618728b95fc72f82ca89322f4e1f673568be64736c395e1b27aae65a65df4";
const OTHER = "a".repeat(64);
const validEnv = {
  NODE_ENV: "test", DATABASE_URL: "postgresql://staff:test@localhost:5432/restaurant",
  AUTH_ACCESS_SECRET: "test-only-unit-secret-with-adequate-entropy-2026",
};
describe("Encrypted Expo tokens and worker policy", () => {
  it("allows only Expo push token formats and never stores token plaintext", () => {
    expect(validExpoPushToken(TOKEN)).toBe(true);
    expect(validExpoPushToken("ExponentPushToken[abcdefghijklmnopqrst1234567890]")).toBe(true);
    expect(validExpoPushToken("https://api.example.com/attacker")).toBe(false);
    expect(validExpoPushToken("invalid")).toBe(false);
    expect(pushTokenHash(TOKEN)).toMatch(/^[0-9a-f]{64}$/);
    expect(pushTokenHash(TOKEN)).not.toContain(TOKEN);
    const box = sealPushToken(TOKEN, KEY);
    expect(box).not.toContain(TOKEN);
    expect(openPushToken(box, KEY)).toBe(TOKEN);
    expect(sealPushToken(TOKEN, KEY)).not.toEqual(box); // random IV
    expect(() => openPushToken(box, OTHER)).toThrow();
    const tampered = box.slice(0,-1) + (box.endsWith("A") ? "B" : "A");
    expect(() => openPushToken(tampered, KEY)).toThrow();
  });
  it("caps exponential delivery backoff and validates opt-in push environment", () => {
    expect(pushRetryDelay(1)).toBe(2000);
    expect(pushRetryDelay(2)).toBe(4000);
    expect(pushRetryDelay(8)).toBe(120000);
    expect(parseRuntimeConfig(validEnv).pushDispatchEnabled).toBe(false);
    expect(() => parseRuntimeConfig({ ...validEnv, PUSH_DISPATCH_ENABLED: "true" }))
      .toThrow("PUSH_TOKEN_ENCRYPTION_KEY");
    expect(() => parseRuntimeConfig({ ...validEnv, PUSH_TOKEN_ENCRYPTION_KEY: "x" }))
      .toThrow("PUSH_TOKEN_ENCRYPTION_KEY");
    expect(() => parseRuntimeConfig({ ...validEnv, PUSH_DISPATCH_ENABLED: "yes" }))
      .toThrow("PUSH_DISPATCH_ENABLED");
    expect(parseRuntimeConfig({ ...validEnv, PUSH_DISPATCH_ENABLED: "true",
      PUSH_TOKEN_ENCRYPTION_KEY: KEY }).pushDispatchEnabled).toBe(true);
  });
});
