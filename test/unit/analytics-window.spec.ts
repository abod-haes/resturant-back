import { DEFAULT_ANALYTICS_DAYS, MAX_ANALYTICS_DAYS, resolveReportWindow } from "../../src/modules/analytics/domain/report-window";

describe("Call analytics UTC report window", () => {
  it("defaults to 30 UTC days including current day, exclusive end", () => {
    const window = resolveReportWindow(undefined, undefined, new Date("2026-11-20T20:00:00.000Z"));
    expect(DEFAULT_ANALYTICS_DAYS).toBe(30);
    expect(window.dates).toHaveLength(30);
    expect(window.from).toBe("2026-10-22");
    expect(window.to).toBe("2026-11-21");
    expect(window.dates[0]).toBe("2026-10-22");
    expect(window.dates.at(-1)).toBe("2026-11-20");
    expect(window.start.toISOString()).toBe("2026-10-22T00:00:00.000Z");
  });
  it("handles leap day and fills exactly one row per day", () => {
    const window = resolveReportWindow("2024-02-28","2024-03-02");
    expect(window.dates).toEqual(["2024-02-28","2024-02-29","2024-03-01"]);
  });
  it("accepts exactly 90 days, rejects 91 and reversed/zero windows", () => {
    expect(MAX_ANALYTICS_DAYS).toBe(90);
    expect(resolveReportWindow("2026-01-01","2026-04-01").dates).toHaveLength(90);
    expect(() => resolveReportWindow("2026-01-01","2026-04-02")).toThrow("90");
    expect(() => resolveReportWindow("2026-02-01","2026-02-01")).toThrow("90");
    expect(() => resolveReportWindow("2026-02-02","2026-02-01")).toThrow("90");
  });
  it("rejects invalid calendar dates, incomplete bounds and timestamps", () => {
    expect(() => resolveReportWindow("2026-02-30","2026-03-01")).toThrow();
    expect(() => resolveReportWindow("2026-02-01","2026-03-01T00:00:00Z")).toThrow();
    expect(() => resolveReportWindow("2026-02-01")).toThrow();
    expect(() => resolveReportWindow(undefined,"2026-03-01")).toThrow();
    expect(() => resolveReportWindow("2025-13-01","2025-13-02")).toThrow();
    expect(() => resolveReportWindow("2026-2-01","2026-03-01")).toThrow();
  });
});
