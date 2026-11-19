import type { Department, PlatformRole } from "../../../database/database.types";
export type { AuthPrincipal } from "../../../common/auth/principal";

export interface AuthUser {
  readonly id: string;
  readonly role: PlatformRole;
  readonly restaurantId: string | null;
  readonly branchId: string | null;
  readonly department: Department | null;
  readonly mustChangePassword: boolean;
}
