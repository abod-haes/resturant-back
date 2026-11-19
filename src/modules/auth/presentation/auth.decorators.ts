import { SetMetadata } from "@nestjs/common";
import type { PlatformRole } from "../../../database/database.types";

export const PUBLIC_KEY = "auth:isPublic";
export const AUTHENTICATED_KEY = "auth:authenticated";
export const ALLOW_PASSWORD_CHANGE_KEY = "auth:allowInitialPassword";
export const ROLES_KEY = "auth:roles";
export const RESOURCE_SCOPE_KEY = "auth:resourceScope";

export interface ResourceScope {
  readonly kind: "restaurant" | "branch";
  readonly parameter: string;
}

export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const AllowAuthenticated = () => SetMetadata(AUTHENTICATED_KEY, true);
export const AllowInitialPassword = () => SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);
export const Roles = (...roles: PlatformRole[]) => SetMetadata(ROLES_KEY, roles);
export const RestaurantScope = (parameter: string) =>
  SetMetadata(RESOURCE_SCOPE_KEY, { kind: "restaurant", parameter } satisfies ResourceScope);
export const BranchScope = (parameter: string) =>
  SetMetadata(RESOURCE_SCOPE_KEY, { kind: "branch", parameter } satisfies ResourceScope);
