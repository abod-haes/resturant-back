import type { EntitlementSnapshot, PlanFeatures, SubscriptionPeriod, SubscriptionStatus } from "../../../database/database.types";

export type EffectiveSubscriptionStatus = "pending" | "scheduled" | "active" | "grace" | "expired" | "cancelled";

export function addCalendarPeriod(start: Date, period: SubscriptionPeriod): Date {
  if (!Number.isFinite(start.getTime())) throw new Error("Invalid start date");
  const months = period === "monthly" ? 1 : 12;
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;
  const firstOfTarget = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const result = new Date(firstOfTarget.getTime());
  result.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  result.setUTCHours(start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), start.getUTCMilliseconds());
  return result;
}

export function addGraceDays(end: Date, graceDays: number): Date {
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 365) throw new Error("Invalid grace days");
  return new Date(end.getTime() + graceDays * 86400_000);
}

export function effectiveSubscriptionStatus(row: {
  status: SubscriptionStatus;
  starts_at: Date | null;
  ends_at: Date | null;
  grace_ends_at: Date | null;
}, now: Date): EffectiveSubscriptionStatus {
  if (row.status !== "active") return row.status;
  if (!row.starts_at || !row.ends_at || !row.grace_ends_at) return "expired";
  if (now < row.starts_at) return "scheduled";
  if (now < row.ends_at) return "active";
  if (now < row.grace_ends_at) return "grace";
  return "expired";
}

export function canOperate(status: EffectiveSubscriptionStatus): boolean {
  return status === "active" || status === "grace";
}

export function planEntitlements(plan: {
  max_branches: number;
  max_tables: number;
  max_employees: number;
  features: PlanFeatures;
}): EntitlementSnapshot {
  return {
    maxBranches: plan.max_branches,
    maxTables: plan.max_tables,
    maxEmployees: plan.max_employees,
    features: {
      menu: plan.features.menu === true,
      waiter_calls: plan.features.waiter_calls === true,
      hookah_calls: plan.features.hookah_calls === true,
      analytics: plan.features.analytics === true,
    },
  };
}
