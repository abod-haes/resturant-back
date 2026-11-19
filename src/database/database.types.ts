import type { ColumnType, Generated } from "kysely";

export type PlatformRole = "PRIMARY_ADMIN" | "PLATFORM_ADMIN" | "RESTAURANT_OWNER" | "EMPLOYEE";
export type Department = "waiter" | "hookah";
export type SubscriptionPeriod = "monthly" | "yearly";
export type SubscriptionStatus = "pending" | "active" | "expired" | "cancelled";
export type FeatureKey = "menu" | "waiter_calls" | "hookah_calls" | "analytics";
export type PlanFeatures = Record<FeatureKey, boolean>;
export interface EntitlementSnapshot {
  maxBranches: number;
  maxTables: number;
  maxEmployees: number;
  features: PlanFeatures;
}

interface Timestamped {
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RestaurantsTable extends Timestamped {
  id: Generated<string>;
  name: string;
  slug: string;
  is_active: Generated<boolean>;
}

export interface BranchesTable extends Timestamped {
  id: Generated<string>;
  restaurant_id: string;
  name: string;
  slug: string;
  currency: string | null;
  is_active: Generated<boolean>;
}

export interface CategoriesTable extends Timestamped {
  id: Generated<string>;
  restaurant_id: string;
  branch_id: string;
  name: string;
  description: string | null;
  sort_order: Generated<number>;
  is_active: Generated<boolean>;
  archived_at: Date | null;
}

export interface ProductsTable extends Timestamped {
  id: Generated<string>;
  restaurant_id: string;
  branch_id: string;
  category_id: string;
  name: string;
  description: string | null;
  price_minor: number;
  old_price_minor: number | null;
  currency: string;
  tags: ColumnType<string[], string[] | undefined, string[]>;
  is_visible: Generated<boolean>;
  is_sold_out: Generated<boolean>;
  sort_order: Generated<number>;
  archived_at: Date | null;
}

export interface ProductImagesTable {
  id: Generated<string>;
  product_id: string;
  branch_id: string;
  url: string;
  alt: string | null;
  sort_order: number;
  created_at: Generated<Date>;
}

export interface UsersTable extends Timestamped {
  id: Generated<string>;
  username: string;
  display_name: string;
  password_hash: string;
  role: PlatformRole;
  restaurant_id: string | null;
  branch_id: string | null;
  department: Department | null;
  must_change_password: Generated<boolean>;
  is_active: Generated<boolean>;
}

export interface PlansTable extends Timestamped {
  id: Generated<string>;
  name: string;
  max_branches: number;
  max_tables: number;
  max_employees: number;
  features: ColumnType<PlanFeatures, PlanFeatures | undefined, PlanFeatures>;
  is_active: Generated<boolean>;
}

export interface SubscriptionsTable extends Timestamped {
  id: Generated<string>;
  restaurant_id: string;
  plan_id: string;
  period: SubscriptionPeriod;
  status: Generated<SubscriptionStatus>;
  starts_at: Date | null;
  ends_at: Date | null;
  grace_ends_at: Date | null;
  activated_by_user_id: string | null;
  grace_days: Generated<number>;
  entitlement_snapshot: Generated<EntitlementSnapshot | null>;
}

export interface SubscriptionTermsTable {
  id: Generated<string>;
  subscription_id: string;
  sequence: number;
  plan_id: string;
  period: SubscriptionPeriod;
  starts_at: Date;
  ends_at: Date;
  grace_ends_at: Date;
  entitlement_snapshot: ColumnType<EntitlementSnapshot, EntitlementSnapshot, never>;
  activated_by_user_id: string;
  created_at: Generated<Date>;
}

export interface RenewalContactsTable {
  id: Generated<string>;
  type: "whatsapp" | "phone" | "email";
  label: string;
  value: string;
  is_enabled: Generated<boolean>;
  sort_order: number;
  created_at: Generated<Date>;
}

export interface AuditLogsTable {
  id: Generated<string>;
  actor_user_id: string | null;
  restaurant_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  request_id: string | null;
  metadata: ColumnType<Record<string, unknown>, Record<string, unknown> | undefined, never>;
  created_at: Generated<Date>;
}

export interface AuthSessionsTable {
  id: Generated<string>;
  user_id: string;
  refresh_hash: string;
  previous_refresh_hash: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Generated<Date>;
  rotated_at: Generated<Date>;
}

export interface AuthRefreshHistoryTable {
  refresh_hash: string;
  session_id: string;
  created_at: Generated<Date>;
}

export interface AuthLoginAttemptsTable {
  identity_hash: string;
  attempts: Generated<number>;
  window_started_at: Generated<Date>;
  blocked_until: Date | null;
}

export interface DatabaseTables {
  restaurants: RestaurantsTable;
  branches: BranchesTable;
  categories: CategoriesTable;
  products: ProductsTable;
  product_images: ProductImagesTable;
  users: UsersTable;
  plans: PlansTable;
  subscriptions: SubscriptionsTable;
  subscription_terms: SubscriptionTermsTable;
  renewal_contacts: RenewalContactsTable;
  audit_logs: AuditLogsTable;
  auth_sessions: AuthSessionsTable;
  auth_login_attempts: AuthLoginAttemptsTable;
  auth_refresh_history: AuthRefreshHistoryTable;
}
