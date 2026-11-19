import { generateOpaqueToken, hashOpaqueToken, isOpaqueToken } from "../../src/common/crypto/opaque-token";
import { availableCalls } from "../../src/modules/visits/application/visits.service";
import { VISIT_IDLE_HOURS, CALL_COOLDOWN_SECONDS, visitExpiresAt, cooldownSeconds } from "../../src/common/visits/visit-policy";

describe("QR visit and service-call domain rules", () => {
  it("generates 256-bit opaque, distinct session capabilities with stored-only hashes", () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
    expect(isOpaqueToken(a)).toBe(true);
    expect(hashOpaqueToken(a)).toHaveLength(64);
    expect(hashOpaqueToken(a)).not.toBe(a);
    expect(isOpaqueToken("token")).toBe(false);
  });
  it("expires after exactly four hours of inactivity", () => {
    const start = new Date("2026-11-19T20:00:00.000Z");
    expect(VISIT_IDLE_HOURS).toBe(4);
    expect(visitExpiresAt(start).toISOString()).toBe("2026-11-20T00:00:00.000Z");
  });
  it("calculates cooldown time using ceiling to prevent early retry", () => {
    const first = new Date("2026-11-19T20:00:00.000Z");
    expect(CALL_COOLDOWN_SECONDS).toBe(10);
    expect(cooldownSeconds(first, new Date("2026-11-19T20:00:00.100Z"))).toBe(10);
    expect(cooldownSeconds(first, new Date("2026-11-19T20:00:05.500Z"))).toBe(5);
    expect(cooldownSeconds(first, new Date("2026-11-19T20:00:10.000Z"))).toBe(0);
    expect(cooldownSeconds(first, new Date("2026-11-19T20:00:11.000Z"))).toBe(0);
  });
  it("shows enabled department call buttons only when table calls are allowed", () => {
    expect(availableCalls({waiter_calls:true,hookah_calls:true},true)).toEqual(["waiter","hookah"]);
    expect(availableCalls({waiter_calls:true,hookah_calls:false},true)).toEqual(["waiter"]);
    expect(availableCalls({waiter_calls:true,hookah_calls:true},false)).toEqual([]);
    expect(availableCalls({waiter_calls:false,hookah_calls:false},true)).toEqual([]);
  });
});
