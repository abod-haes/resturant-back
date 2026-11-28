import { managedImagePath } from "../../../common/tenancy/managed-image-path";
import { Inject, Injectable, UnauthorizedException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { subdomainFromOrigin } from "../../../common/tenancy/subdomain";
import { browserApplication } from "../domain/browser-session";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes } from "node:crypto";
import { DatabaseService } from "../../../database/database.service";
import { RUNTIME_CONFIG, type RuntimeConfig } from "../../../common/config/runtime-config";
import type { AuthenticatedRestaurantIdentityDto } from "../presentation/auth.dto";
import type { AuthPrincipal, AuthUser } from "../domain/auth.types";
import { hashPassword, verifyPassword } from "../domain/password";
import { LoginThrottleService } from "./login-throttle.service";

const ACCESS_SECONDS = 15 * 60;
const REFRESH_DAYS = 30;
const ISSUER = "restaurant-platform";
const AUDIENCE = "restaurant-clients";

interface AccessClaims {
  sub: string;
  sid: string;
  typ: "access";
  iat?: number;
  exp?: number;
}

interface UserRecord {
  display_name: string;
  username: string;
  id: string;
  role: AuthUser["role"];
  restaurant_id: string | null;
  branch_id: string | null;
  department: AuthUser["department"];
  must_change_password: boolean;
  is_active: boolean;
  restaurant_active: boolean | null;
  branch_active: boolean | null;
  password_hash: string;
}

export interface IssuedSession {
  accessToken: string;
  expiresAt: string;
  refreshToken: string;
  user: AuthUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly jwt: JwtService,
    private readonly throttle: LoginThrottleService,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  async assertBrowserTenant(user: Pick<AuthUser, "restaurantId" | "role">, origin?: string): Promise<void> {
    const application = browserApplication(origin, this.config.restaurantBaseDomain);
    if ((application === "admin" && user.role !== "PRIMARY_ADMIN" && user.role !== "PLATFORM_ADMIN") ||
        (application === "owner" && user.role !== "RESTAURANT_OWNER") ||
        (application === "employee" && user.role !== "EMPLOYEE")) {
      throw new UnauthorizedException("Invalid application account");
    }
    const subdomain = subdomainFromOrigin(origin, this.config.restaurantBaseDomain);
    if (!subdomain) return;
    if (user.role !== "RESTAURANT_OWNER" || !user.restaurantId) throw new UnauthorizedException("Invalid restaurant account");
    const restaurant = await this.database.db.selectFrom("restaurants").select("id")
      .where("id", "=", user.restaurantId).where("subdomain", "=", subdomain)
      .where("domain_status", "=", "ready").where("is_active", "=", true).executeTakeFirst();
    if (!restaurant) throw new UnauthorizedException("Invalid restaurant account");
  }

  async restaurantIdentity(principal: AuthPrincipal): Promise<AuthenticatedRestaurantIdentityDto> {
    if (!principal.restaurantId || (principal.role !== "RESTAURANT_OWNER" && principal.role !== "EMPLOYEE")) {
      throw new ForbiddenException("Restaurant account required");
    }
    const restaurant = await this.database.db.selectFrom("restaurants")
      .select(["id", "name", "subdomain", "logo_url", "primary_color", "secondary_color", "font_family"])
      .where("id", "=", principal.restaurantId)
      .where("is_active", "=", true)
      .executeTakeFirst();
    if (!restaurant) throw new ForbiddenException("Restaurant unavailable");
    return {
      id: restaurant.id, name: restaurant.name, subdomain: restaurant.subdomain,
      branding: {
        logoUrl: restaurant.logo_url, logoPath: managedImagePath(restaurant.logo_url, restaurant.id, this.config.mediaStorage?.publicOrigin), primaryColor: restaurant.primary_color,
        secondaryColor: restaurant.secondary_color, fontFamily: restaurant.font_family,
      },
    };
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
  }

  private createRefreshToken(): string {
    return randomBytes(48).toString("base64url");
  }

  private toPublicUser(user: UserRecord): AuthUser {
    return {
      id: user.id,
      name: user.display_name,
      username: user.username,
      role: user.role,
      restaurantId: user.restaurant_id,
      branchId: user.branch_id,
      department: user.department,
      mustChangePassword: user.must_change_password,
    };
  }

  private isActive(user: UserRecord): boolean {
    return user.is_active &&
      (user.restaurant_id === null || user.restaurant_active === true) &&
      (user.branch_id === null || user.branch_active === true);
  }

  private async findUserByUsername(username: string): Promise<UserRecord | undefined> {
    return this.database.db.selectFrom("users")
      .leftJoin("restaurants", "restaurants.id", "users.restaurant_id")
      .leftJoin("branches", "branches.id", "users.branch_id")
      .select([
        "users.id", "users.display_name", "users.username", "users.role", "users.restaurant_id", "users.branch_id",
        "users.department", "users.password_hash", "users.must_change_password",
        "users.is_active", "restaurants.is_active as restaurant_active",
        "branches.is_active as branch_active",
      ])
      .where(sqlLowerUsername(), "=", username.toLowerCase())
      .executeTakeFirst();
  }

  private async findUserById(id: string): Promise<UserRecord | undefined> {
    return this.database.db.selectFrom("users")
      .leftJoin("restaurants", "restaurants.id", "users.restaurant_id")
      .leftJoin("branches", "branches.id", "users.branch_id")
      .select([
        "users.id", "users.display_name", "users.username", "users.role", "users.restaurant_id", "users.branch_id",
        "users.department", "users.password_hash", "users.must_change_password",
        "users.is_active", "restaurants.is_active as restaurant_active",
        "branches.is_active as branch_active",
      ])
      .where("users.id", "=", id)
      .executeTakeFirst();
  }

  private async signAccess(userId: string, sessionId: string): Promise<{ token: string; expiresAt: string }> {
    const token = await this.jwt.signAsync(
      { sub: userId, sid: sessionId, typ: "access" },
      { secret: this.config.authAccessSecret, algorithm: "HS256", issuer: ISSUER,
        audience: AUDIENCE, expiresIn: ACCESS_SECONDS },
    );
    return { token, expiresAt: new Date(Date.now() + ACCESS_SECONDS * 1000).toISOString() };
  }

  async login(username: string, password: string, origin?: string): Promise<IssuedSession> {
    await this.throttle.assertAllowed(username);
    const user = await this.findUserByUsername(username);
    // Perform an expensive password hash even when the account does not exist, to reduce enumeration timing.
    if (!user) await hashPassword("UnknownAccountPlaceholderPassword!");
    const correct = user ? await verifyPassword(password, user.password_hash) : false;
    if (!correct || !user || !this.isActive(user)) {
      await this.throttle.recordFailure(username);
      throw new UnauthorizedException("Invalid credentials");
    }

    await this.assertBrowserTenant(this.toPublicUser(user), origin);
    const refreshToken = this.createRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_DAYS * 86400 * 1000);
    const session = await this.database.db.insertInto("auth_sessions")
      .values({ user_id: user.id, refresh_hash: this.hashToken(refreshToken),
        previous_refresh_hash: null, expires_at: expiresAt, revoked_at: null })
      .returning("id")
      .executeTakeFirstOrThrow();
    await this.throttle.clear(username);
    const access = await this.signAccess(user.id, session.id);
    return { accessToken: access.token, expiresAt: access.expiresAt,
      refreshToken, user: this.toPublicUser(user) };
  }

  async authenticate(accessToken: string): Promise<AuthPrincipal> {
    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(accessToken, {
        secret: this.config.authAccessSecret,
        algorithms: ["HS256"],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired session");
    }
    if (claims.typ !== "access" || !isUuid(claims.sub) || !isUuid(claims.sid)) {
      throw new UnauthorizedException("Invalid or expired session");
    }

    const session = await this.database.db.selectFrom("auth_sessions")
      .select(["id", "user_id", "expires_at", "revoked_at"])
      .where("id", "=", claims.sid).where("user_id", "=", claims.sub).executeTakeFirst();
    if (!session || session.revoked_at || session.expires_at <= new Date()) {
      throw new UnauthorizedException("Invalid or expired session");
    }
    const user = await this.findUserById(claims.sub);
    if (!user || !this.isActive(user)) throw new UnauthorizedException("Invalid or expired session");
    return { ...this.toPublicUser(user), sessionId: session.id };
  }

  async refresh(refreshToken: string, origin?: string): Promise<IssuedSession> {
    if (!isRefreshToken(refreshToken)) throw new UnauthorizedException("Invalid refresh credential");
    const oldHash = this.hashToken(refreshToken);
    const nextToken = this.createRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_DAYS * 86400 * 1000);

    await this.assertRefreshTenant(oldHash, origin);
    const updated = await this.database.db.transaction().execute(async (trx) => {
      const session = await trx.updateTable("auth_sessions")
        .set({ refresh_hash: this.hashToken(nextToken), previous_refresh_hash: oldHash,
          rotated_at: new Date(), expires_at: expiresAt })
        .where("refresh_hash", "=", oldHash)
        .where("revoked_at", "is", null)
        .where("expires_at", ">", new Date())
        .returning(["id", "user_id"])
        .executeTakeFirst();

      if (!session) {
        const used = await trx.selectFrom("auth_refresh_history").select("session_id")
          .where("refresh_hash", "=", oldHash).executeTakeFirst();
        if (used) {
          await trx.updateTable("auth_sessions")
            .set({ revoked_at: new Date() })
            .where("id", "=", used.session_id)
            .where("revoked_at", "is", null)
            .execute();
        }
        return null;
      }

      await trx.insertInto("auth_refresh_history")
        .values({ session_id: session.id, refresh_hash: oldHash }).execute();
      return session;
    });

    if (!updated) throw new UnauthorizedException("Invalid refresh credential");
    const user = await this.findUserById(updated.user_id);
    if (!user || !this.isActive(user)) {
      await this.database.db.updateTable("auth_sessions")
        .set({ revoked_at: new Date() })
        .where("id", "=", updated.id).execute();
      throw new UnauthorizedException("Invalid refresh credential");
    }
    const access = await this.signAccess(user.id, updated.id);
    return { accessToken: access.token, expiresAt: access.expiresAt,
      refreshToken: nextToken, user: this.toPublicUser(user) };
  }

  /** Revoke a browser session using its authenticated bearer when the HttpOnly
   * refresh cookie is unavailable (e.g. localhost frontend and cross-site API).
   * authenticate() validates signature, expiry, user and live DB session first. */
  async logoutAccessSession(accessToken: string, origin?: string): Promise<void> {
    const principal = await this.authenticate(accessToken);
    await this.assertBrowserTenant(principal, origin);
    await this.database.db.updateTable("auth_sessions")
      .set({ revoked_at: new Date() })
      .where("id", "=", principal.sessionId)
      .where("revoked_at", "is", null)
      .execute();
  }

  private async assertRefreshTenant(digest: string, origin?: string): Promise<void> {
    if (!subdomainFromOrigin(origin, this.config.restaurantBaseDomain) && !browserApplication(origin, this.config.restaurantBaseDomain)) return;
    const db = this.database.db;
    const current = await db.selectFrom("auth_sessions").select("user_id").where("refresh_hash", "=", digest).executeTakeFirst();
    const historic = current ? undefined : await db.selectFrom("auth_refresh_history").innerJoin("auth_sessions", "auth_sessions.id", "auth_refresh_history.session_id").select("auth_sessions.user_id").where("auth_refresh_history.refresh_hash", "=", digest).executeTakeFirst();
    const userId = current?.user_id ?? historic?.user_id;
    if (!userId) throw new UnauthorizedException("Invalid refresh credential");
    const user = await this.findUserById(userId);
    if (!user) throw new UnauthorizedException("Invalid refresh credential");
    await this.assertBrowserTenant(this.toPublicUser(user), origin);
  }

  async logout(refreshToken: string, origin?: string): Promise<void> {
    if (!isRefreshToken(refreshToken)) throw new UnauthorizedException("Invalid refresh credential");
    const digest = this.hashToken(refreshToken);
    await this.assertRefreshTenant(digest, origin);
    const history = await this.database.db.selectFrom("auth_refresh_history")
      .select("session_id").where("refresh_hash", "=", digest).executeTakeFirst();
    if (history) {
      await this.database.db.updateTable("auth_sessions").set({ revoked_at: new Date() })
        .where("id", "=", history.session_id).where("revoked_at", "is", null).execute();
      return;
    }
    await this.database.db.updateTable("auth_sessions")
      .set({ revoked_at: new Date() })
      .where("refresh_hash", "=", digest)
      .where("revoked_at", "is", null)
      .execute();
  }

  async changePassword(principal: AuthPrincipal, currentPassword: string, newPassword: string, requestId?: string): Promise<void> {
    if (currentPassword === newPassword) {
      throw new BadRequestException("New password must be different");
    }
    const current = await this.findUserById(principal.id);
    if (!current || !this.isActive(current) || !(await verifyPassword(currentPassword, current.password_hash))) {
      throw new ForbiddenException("Current password is incorrect");
    }
    const passwordHash = await hashPassword(newPassword);
    await this.database.db.transaction().execute(async (trx) => {
      const changed = await trx.updateTable("users")
        .set({ password_hash: passwordHash, must_change_password: false })
        .where("id", "=", principal.id)
        .where("password_hash", "=", current.password_hash)
        .returning("id").executeTakeFirst();
      if (!changed) throw new UnauthorizedException("Password has already changed");
      await trx.updateTable("auth_sessions").set({ revoked_at: new Date() })
        .where("user_id", "=", principal.id).where("revoked_at", "is", null).execute();
      await trx.insertInto("audit_logs").values({
        actor_user_id: principal.id,
        restaurant_id: principal.restaurantId,
        action: "auth.password_changed",
        entity_type: "user",
        entity_id: principal.id,
        request_id: requestId ?? null,
        metadata: {},
      }).execute();
    });
  }
}

import { sql } from "kysely";

function sqlLowerUsername() {
  return sql<string>`lower(users.username)`;
}

function isUuid(value: unknown): value is string {
  // PostgreSQL's uuid type accepts UUIDs with non-RFC version/variant bits.
  // Some existing users were created with such IDs, and login must not issue
  // an access token that authenticate() immediately rejects. JWT signature,
  // issuer, audience, expiration and the database-backed session are still
  // verified independently before granting access.
  return typeof value === "string" &&
    /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
}

function isRefreshToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{64}$/.test(value);
}
