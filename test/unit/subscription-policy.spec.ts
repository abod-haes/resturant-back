import {
  addCalendarPeriod, addGraceDays, canOperate, effectiveSubscriptionStatus, planEntitlements,
} from "../../src/modules/subscriptions/domain/subscription-policy";

describe("Subscription policy: calendar, expiry and entitlements", () => {
  it("clamps Jan 31 to February and preserves UTC time", () => {
    const jan31 = new Date("2027-01-31T14:25:30.123Z");
    expect(addCalendarPeriod(jan31, "monthly").toISOString()).toBe("2027-02-28T14:25:30.123Z");
    expect(addCalendarPeriod(new Date("2028-01-31T14:25:30.123Z"), "monthly").toISOString())
      .toBe("2028-02-29T14:25:30.123Z");
  });
  it("handles year renewal on leap day", () => {
    expect(addCalendarPeriod(new Date("2028-02-29T00:00:00.000Z"), "yearly").toISOString())
      .toBe("2029-02-28T00:00:00.000Z");
  });
  it("does not assume monthly means 30 days and derives grace exactly", () => {
    const start = new Date("2027-04-01T12:00:00.000Z");
    const end = addCalendarPeriod(start, "monthly");
    expect(end.toISOString()).toBe("2027-05-01T12:00:00.000Z");
    expect(addGraceDays(end, 7).toISOString()).toBe("2027-05-08T12:00:00.000Z");
    expect(() => addGraceDays(end, -1)).toThrow();
    expect(() => addGraceDays(end, 366)).toThrow();
  });
  it("enforces scheduled, active, grace and expired boundaries", () => {
    const row = {
      status: "active" as const,
      starts_at: new Date("2026-11-20T00:00:00Z"),
      ends_at: new Date("2026-12-20T00:00:00Z"),
      grace_ends_at: new Date("2026-12-27T00:00:00Z"),
    };
    expect(effectiveSubscriptionStatus(row, new Date("2026-11-19T23:59:59Z"))).toBe("scheduled");
    expect(effectiveSubscriptionStatus(row, row.starts_at)).toBe("active");
    expect(effectiveSubscriptionStatus(row, row.ends_at)).toBe("grace");
    expect(effectiveSubscriptionStatus(row, row.grace_ends_at)).toBe("expired");
    expect(canOperate("grace")).toBe(true);
    expect(canOperate("scheduled")).toBe(false);
    expect(canOperate("expired")).toBe(false);
    expect(effectiveSubscriptionStatus({ ...row, status: "pending" }, new Date())).toBe("pending");
  });
  it("creates isolated boolean feature snapshots", () => {
    const snapshot = planEntitlements({
      max_branches: 3, max_tables: 50, max_employees: 10,
      features: { menu: true, waiter_calls: true, hookah_calls: false, analytics: false },
    });
    expect(snapshot).toEqual({
      maxBranches: 3, maxTables: 50, maxEmployees: 10,
      features: { menu: true, waiter_calls: true, hookah_calls: false, analytics: false },
    });
  });
});
