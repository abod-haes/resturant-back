import type { Department, PlatformRole } from "../../database/database.types";

export interface AuthPrincipal {
  readonly id: string;
  readonly role: PlatformRole;
  readonly restaurantId: string | null;
  readonly branchId: string | null;
  readonly department: Department | null;
  readonly mustChangePassword: boolean;
  readonly sessionId: string;
}
