import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { IncomingMessage } from "node:http";
import { DatabaseService } from "../../../database/database.service";
import type { PlatformRole } from "../../../database/database.types";
import type { AuthPrincipal } from "../domain/auth.types";
import { AuthService } from "../application/auth.service";
import { ALLOW_PASSWORD_CHANGE_KEY, AUTHENTICATED_KEY, PUBLIC_KEY, RESOURCE_SCOPE_KEY, ROLES_KEY, type ResourceScope } from "../../../common/auth/policy.decorators";

export interface AuthenticatedRequest extends IncomingMessage {
  principal?: AuthPrincipal;
  requestId?: string;
  params?: Record<string, string>;
}

function metadata<T>(context: ExecutionContext, reflector: Reflector, key: string): T | undefined {
  return reflector.getAllAndOverride<T>(key, [context.getHandler(), context.getClass()]);
}

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (metadata<boolean>(context, this.reflector, PUBLIC_KEY)) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const match = typeof header === "string" ? /^Bearer ([A-Za-z0-9_.-]+)$/.exec(header) : null;
    if (!match) throw new UnauthorizedException("Bearer access token required");
    const principal = await this.auth.authenticate(match[1]);
    if (principal.mustChangePassword &&
      !metadata<boolean>(context, this.reflector, ALLOW_PASSWORD_CHANGE_KEY)) {
      throw new ForbiddenException({ code: "PASSWORD_CHANGE_REQUIRED", message: "Password change required" });
    }
    request.principal = principal;
    return true;
  }
}

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (metadata<boolean>(context, this.reflector, PUBLIC_KEY)) return true;
    const roles = metadata<PlatformRole[]>(context, this.reflector, ROLES_KEY);
    const authenticatedOnly = metadata<boolean>(context, this.reflector, AUTHENTICATED_KEY);
    if (!roles && !authenticatedOnly) throw new ForbiddenException("Route access policy not configured");
    if (!roles) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.principal || !roles.includes(request.principal.role)) {
      throw new ForbiddenException("Insufficient permissions");
    }
    return true;
  }
}

@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly database: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (metadata<boolean>(context, this.reflector, PUBLIC_KEY)) return true;
    const scope = metadata<ResourceScope>(context, this.reflector, RESOURCE_SCOPE_KEY);
    if (!scope) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = request.principal;
    const requestedId = request.params?.[scope.parameter];
    if (!principal || !requestedId) throw new ForbiddenException("Resource scope required");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedId)) {
      throw new NotFoundException("Resource not found");
    }

    if (scope.kind === "restaurant") {
      if (!principal.restaurantId || principal.restaurantId !== requestedId) {
        throw new NotFoundException("Resource not found");
      }
      return true;
    }

    if (principal.role !== "RESTAURANT_OWNER" && principal.role !== "EMPLOYEE") {
      throw new NotFoundException("Resource not found");
    }
    if (principal.role === "EMPLOYEE" && principal.branchId !== requestedId) {
      throw new NotFoundException("Resource not found");
    }
    const branch = await this.database.db.selectFrom("branches")
      .select(["restaurant_id", "is_active"])
      .where("id", "=", requestedId).executeTakeFirst();
    if (!branch || !branch.is_active || !principal.restaurantId ||
      branch.restaurant_id !== principal.restaurantId) {
      throw new NotFoundException("Resource not found");
    }
    return true;
  }
}
