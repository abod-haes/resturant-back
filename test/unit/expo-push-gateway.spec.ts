import { ExpoPushGateway } from "../../src/modules/push/infrastructure/expo-push.gateway";
import { parseRuntimeConfig } from "../../src/common/config/runtime-config";

const config = parseRuntimeConfig({
  NODE_ENV: "test", DATABASE_URL: "postgresql://staff:test@localhost:5432/restaurant",
  AUTH_ACCESS_SECRET: "test-only-unit-secret-with-adequate-entropy-2026",
});
const example = {
  callId: "dc052a37-e215-4d4b-bc2c-d9d76b42efac",
  branchId: "daff0d2e-45b6-431a-a36c-224b4e152500",
  tableId: "0d0f67a4-8a6e-435c-b138-94c1e3ddad4c",
  tableLabel: "طاولة 1",
  type: "waiter" as const,
};
describe("Expo provider protocol, no outbound network", () => {
  afterEach(() => jest.restoreAllMocks());

  it("interprets tickets only as Expo acceptance, with separate receipts", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: "ok", id: "expo-ticket-one" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {
        "expo-ticket-one": { status: "ok" },
      } }), { status: 200 }));
    const client = new ExpoPushGateway(config);
    const ticket = await client.send("ExpoPushToken[abcdefghijklmnopqrst1234567890]", example);
    expect(ticket).toEqual({ ok: true, id: "expo-ticket-one" });
    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toBe("https://exp.host/--/api/v2/push/send");
    const payload = JSON.parse(String((call[1] as RequestInit).body));
    expect(payload.channelId).toBe("waiter_calls");
    expect(payload.data).not.toHaveProperty("sessionToken");
    expect(payload.data).not.toHaveProperty("qrToken");
    expect(payload.ttl).toBe(120);
    const receipts = await client.receipts(["expo-ticket-one"]);
    expect(receipts["expo-ticket-one"]).toEqual({ status: "ok" });
  });

  it("retries 429 and transient provider tickets but never permanent unregistered devices", async () => {
    jest.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: "error",
        details: { error: "MessageRateExceeded" } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: "error",
        details: { error: "DeviceNotRegistered" } } }), { status: 200 }));
    const client = new ExpoPushGateway(config);
    expect(await client.send("ExpoPushToken[abcdefghijklmnopqrst1234567890]", example))
      .toEqual({ ok: false, errorCode: "EXPO_TEMPORARY", retryable: true });
    expect(await client.send("ExpoPushToken[abcdefghijklmnopqrst1234567890]", example))
      .toEqual({ ok: false, errorCode: "MessageRateExceeded", retryable: true });
    expect(await client.send("ExpoPushToken[abcdefghijklmnopqrst1234567890]", example))
      .toEqual({ ok: false, errorCode: "DeviceNotRegistered", retryable: false });
  });
});
