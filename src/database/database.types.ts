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
  subdomain: Generated<string | null>;
  domain_status: Generated<"pending" | "ready">;
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
  restaurant_id: string;
  media_asset_id: string | null;
  url: string;
  alt: string | null;
  sort_order: number;
  created_at: Generated<Date>;
}

export interface FloorsTable extends Timestamped {
  id: Generated<string>;
  restaurant_id: string;
  branch_id: string;
  name: string;
  sort_order: Generated<number>;
  is_active: Generated<boolean>;
  archived_at: Date | null;
}

export interface AreasTable extends Timestamped {
  id: Generated<string>;
  restaurant_id: string;
  branch_id: string;
  floor_id: string;
  name: string;
  sort_order: Generated<number>;
  is_active: Generated<boolean>;
  archived_at: Date | null;
}

export interface RestaurantTablesTable extends Timestamped {
  id: Generated<string>;
  restaurant_id: string;
  branch_id: string;
  area_id: string;
  label: string;
  sort_order: Generated<number>;
  is_active: Generated<boolean>;
  qr_enabled: Generated<boolean>;
  calls_enabled: Generated<boolean>;
  qr_version: Generated<number>;
  archived_at: Date | null;
}

export interface QrCredentialsTable {
  id: Generated<string>;
  table_id: string;
  branch_id: string;
  version: number;
  token_hash: string;
  token_box: string;
  created_at: Generated<Date>;
  revoked_at: Date | null;
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
  archived_at: Generated<Date | null>;
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

export type CallRoutingMode = "all_on_shift" | "department_on_shift";
export type CallType = "waiter" | "hookah";
export type CallDeliveryState = "queued" | "no_staff";
export interface RestaurantCallSettingsTable { restaurant_id: string; enabled: Generated<boolean>; waiter_enabled: Generated<boolean>; hookah_enabled: Generated<boolean>; routing_mode: Generated<CallRoutingMode>; shift_auto_end_minutes: Generated<number>; updated_at: Generated<Date>; }
export interface BranchCallSettingsTable { branch_id: string; enabled: boolean | null; waiter_enabled: boolean | null; hookah_enabled: boolean | null; routing_mode: CallRoutingMode | null; updated_at: Generated<Date>; }
export interface EmployeeShiftsTable { id: Generated<string>; user_id: string; restaurant_id: string; branch_id: string; department: Department; started_at: Generated<Date>; auto_end_at: Date; ended_at: Date | null; ended_by_user_id: string | null; }
export interface VisitSessionsTable { id: Generated<string>; restaurant_id: string; branch_id: string; table_id: string; credential_id: string; credential_version: number; token_hash: string; created_at: Generated<Date>; last_activity_at: Generated<Date>; expires_at: Date; first_call_confirmed: Generated<boolean>; revoked_at: Date | null; }
export interface ServiceCallsTable { id: Generated<string>; restaurant_id: string; branch_id: string; table_id: string; session_id: string; type: CallType; idempotency_key: string; delivery_state: CallDeliveryState; recipients_count: number; owner_alerted: boolean; created_at: Generated<Date>; }
export interface CallOutboxTable { id: Generated<string>; call_id: string; recipient_user_id: string; state: Generated<"pending" | "sent" | "failed">; attempts: Generated<number>; created_at: Generated<Date>; last_attempt_at: Date | null; next_attempt_at: Generated<Date>; }
export interface OwnerAlertsTable { id: Generated<string>; restaurant_id: string; branch_id: string; call_id: string; type: "no_staff"; created_at: Generated<Date>; viewed_at: Date | null; }
export type RealtimeEventType = "call.created" | "owner.alert.created" | "shift.updated";
export type PushDeliveryStatus = "pending" | "accepted" | "failed";
export type PushReceiptStatus = "waiting" | "ok" | "error" | "expired";

export interface EmployeePushDevicesTable {
  id: Generated<string>;
  user_id: string;
  platform: "android" | "ios";
  token_hash: string;
  token_box: string;
  is_active: Generated<boolean>;
  last_seen_at: Generated<Date>;
  created_at: Generated<Date>;
}
export interface PushDeliveriesTable {
  id: Generated<string>;
  outbox_id: string;
  device_id: string;
  state: Generated<PushDeliveryStatus>;
  attempts: Generated<number>;
  next_attempt_at: Generated<Date>;
  lease_until: Date | null;
  ticket_id: string | null;
  receipt_status: Generated<PushReceiptStatus>;
  receipt_checked_at: Date | null;
  last_error_code: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
export interface RestaurantEventCountersTable {
  restaurant_id: string;
  next_sequence: number;
}
export interface RealtimeEventsTable {
  id: Generated<string>;
  restaurant_id: string;
  sequence: number;
  branch_id: string;
  recipient_user_id: string | null;
  event_type: RealtimeEventType;
  payload: ColumnType<Record<string, unknown>, Record<string, unknown>, never>;
  created_at: Generated<Date>;
}

export type MediaKind = "image" | "document";
export type MediaState = "uploading" | "ready" | "deleting" | "deleted";

export interface MediaAssetsTable {
  id: Generated<string>;
  restaurant_id: string;
  branch_id: string;
  kind: MediaKind;
  object_key: string;
  public_url: string | null;
  original_name: string;
  content_type: "image/webp" | "application/pdf";
  byte_size: number;
  width: number | null;
  height: number | null;
  status: Generated<MediaState>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DatabaseTables {
  restaurants: RestaurantsTable;
  branches: BranchesTable;
  categories: CategoriesTable;
  products: ProductsTable;
  product_images: ProductImagesTable;
  media_assets: MediaAssetsTable;
  floors: FloorsTable;
  areas: AreasTable;
  restaurant_tables: RestaurantTablesTable;
  qr_credentials: QrCredentialsTable;
  users: UsersTable;
  plans: PlansTable;
  subscriptions: SubscriptionsTable;
  subscription_terms: SubscriptionTermsTable;
  renewal_contacts: RenewalContactsTable;
  audit_logs: AuditLogsTable;
  auth_sessions: AuthSessionsTable;
  auth_login_attempts: AuthLoginAttemptsTable;
  auth_refresh_history: AuthRefreshHistoryTable;
  restaurant_call_settings: RestaurantCallSettingsTable;
  branch_call_settings: BranchCallSettingsTable;
  employee_shifts: EmployeeShiftsTable;
  visit_sessions: VisitSessionsTable;
  service_calls: ServiceCallsTable;
  call_outbox: CallOutboxTable;
  owner_alerts: OwnerAlertsTable;
  employee_push_devices: EmployeePushDevicesTable;
  push_deliveries: PushDeliveriesTable;
  restaurant_event_counters: RestaurantEventCountersTable;
  realtime_events: RealtimeEventsTable;
}
