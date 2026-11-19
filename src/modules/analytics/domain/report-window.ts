const DAY_MS = 86_400_000;
export const MAX_ANALYTICS_DAYS = 90;
export const DEFAULT_ANALYTICS_DAYS = 30;
export interface ReportWindow { from: string; to: string; start: Date; end: Date; dates: string[]; }

/** Date-only UTC [from,to), with exclusive end and an explicit bounded window. */
export function resolveReportWindow(from?: string, to?: string, now = new Date()): ReportWindow {
  if ((from === undefined) !== (to === undefined)) throw new RangeError("from and to must both be supplied");
  const utcToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startMs = from === undefined ? utcToday - (DEFAULT_ANALYTICS_DAYS - 1) * DAY_MS : strictUtcDay(from);
  const endMs = to === undefined ? utcToday + DAY_MS : strictUtcDay(to);
  const days = (endMs - startMs) / DAY_MS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_ANALYTICS_DAYS) {
    throw new RangeError("Analytics window must be 1 to 90 UTC days; to is exclusive");
  }
  return {
    from: new Date(startMs).toISOString().slice(0, 10),
    to: new Date(endMs).toISOString().slice(0, 10),
    start: new Date(startMs), end: new Date(endMs),
    dates: Array.from({ length: days }, (_, i) => new Date(startMs + i * DAY_MS).toISOString().slice(0,10)),
  };
}
function strictUtcDay(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError("Date must be YYYY-MM-DD");
  const ms = Date.parse(value + "T00:00:00.000Z");
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) {
    throw new RangeError("Invalid UTC calendar date");
  }
  return ms;
}
