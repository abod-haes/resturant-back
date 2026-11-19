export const VISIT_IDLE_HOURS = 4;
export const CALL_COOLDOWN_SECONDS = 10;
export const MAX_VISITS_PER_TABLE_PER_MINUTE = 30;

export function visitExpiresAt(activity: Date): Date {
  return new Date(activity.getTime() + VISIT_IDLE_HOURS * 60 * 60 * 1000);
}
export function cooldownSeconds(last: Date, now: Date): number {
  return Math.max(0, Math.ceil((CALL_COOLDOWN_SECONDS * 1000 - (now.getTime() - last.getTime())) / 1000));
}
