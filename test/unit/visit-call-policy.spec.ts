import { randomBytes } from "node:crypto";
import { callIsAvailable, type EffectiveCallSettings } from "../../src/common/calls/call-settings";
import { CALL_COOLDOWN_MS, MAX_ACTIVE_VISITS_PER_TABLE, VISIT_IDLE_MS, validVisitToken, visitHash } from "../../src/common/calls/visit-policy";
import type { EntitlementSnapshot } from "../../src/database/database.types";

const full: EntitlementSnapshot = {
  maxBranches: 2, maxTables: 25, maxEmployees: 4,
  features: { menu: true, waiter_calls: true, hookah_calls: true, analytics: false },
};
const settings: EffectiveCallSettings = {
  enabled: true, waiterEnabled: true, hookahEnabled: false,
  routingMode: "all_on_shift", shiftAutoEndMinutes: 720,
};
describe("Visit and call domain policies", () => {
  it("enforces 4h idle visit, 10s cooldown and bounded session issuance", () => {
    expect(VISIT_IDLE_MS).toBe(4 * 60 * 60 * 1000);
    expect(CALL_COOLDOWN_MS).toBe(10 * 1000);
    expect(MAX_ACTIVE_VISITS_PER_TABLE).toBe(200);
  });
  it("accepts only 256-bit base64url visit tokens and hashes without plaintext", () => {
    const token = randomBytes(32).toString("base64url");
    expect(validVisitToken(token)).toBe(true);
    expect(visitHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(visitHash(token)).not.toContain(token);
    expect(validVisitToken("not-a-session")).toBe(false);
    expect(validVisitToken("x".repeat(44))).toBe(false);
  });
  it("never enables hookah without both plan and settings flag", () => {
    expect(callIsAvailable("waiter", true, settings, full)).toBe(true);
    expect(callIsAvailable("hookah", true, settings, full)).toBe(false);
    expect(callIsAvailable("hookah", true, { ...settings, hookahEnabled: true }, full)).toBe(true);
    expect(callIsAvailable("waiter", false, settings, full)).toBe(false);
    expect(callIsAvailable("waiter", true, { ...settings, enabled: false }, full)).toBe(false);
    expect(callIsAvailable("waiter", true, settings, {
      ...full, features: { ...full.features, waiter_calls: false },
    })).toBe(false);
  });
});
