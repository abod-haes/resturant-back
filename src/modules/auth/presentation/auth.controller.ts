import { subdomainFromOrigin } from "../../../common/tenancy/subdomain";
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { Inject } from "@nestjs/common";
import { RUNTIME_CONFIG, type RuntimeConfig } from "../../../common/config/runtime-config";
import { AuthService, type IssuedSession } from "../application/auth.service";
import type { AuthenticatedRequest } from "./auth.guards";
import { AllowAuthenticated, AllowInitialPassword, Public, Roles } from "../../../common/auth/policy.decorators";
import { ChangePasswordDto, ChangedResponseDto, LoginDto, LoginResponseDto, MeResponseDto, RefreshDto, AuthenticatedRestaurantIdentityResponseDto } from "./auth.dto";

const COOKIE_NAME = "restaurant_refresh";

@ApiTags("Authentication")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  private cookieName(origin?: string): string {
    const tenant = subdomainFromOrigin(origin, this.config.restaurantBaseDomain);
    return tenant ? COOKIE_NAME + "_" + tenant : COOKIE_NAME;
  }

  private setRefreshCookie(res: Response, refreshToken: string, origin?: string): void {
    res.cookie(this.cookieName(origin), refreshToken, {
      httpOnly: true,
      secure: this.config.nodeEnv !== "development" && this.config.nodeEnv !== "test",
      sameSite: this.config.authCrossSiteCookie ? "none" : "strict",
      partitioned: this.config.authCrossSiteCookie,
      path: "/api/v1/auth",
      maxAge: 30 * 86400 * 1000,
    });
  }

  private clearRefreshCookie(res: Response, origin?: string): void {
    res.clearCookie(this.cookieName(origin), {
      httpOnly: true,
      secure: this.config.nodeEnv !== "development" && this.config.nodeEnv !== "test",
      sameSite: this.config.authCrossSiteCookie ? "none" : "strict",
      partitioned: this.config.authCrossSiteCookie,
      path: "/api/v1/auth",
    });
  }

  private cookieCredential(request: AuthenticatedRequest, origin?: string): string | undefined {
    const name = this.cookieName(origin);
    const cookies = request.headers.cookie;
    if (!cookies) return undefined;
    const encoded = cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(name + "="));
    if (!encoded) return undefined;
    try {
      return decodeURIComponent(encoded.slice(name.length + 1));
    } catch {
      throw new UnauthorizedException("Invalid refresh credential");
    }
  }

  private requireBrowserOrigin(origin: string | undefined): void {
    if (!origin || (!this.config.corsOrigins.includes("*") && !this.config.corsOrigins.includes(origin))) {
      throw new UnauthorizedException("Invalid browser origin");
    }
  }

  private credential(body: RefreshDto, request: AuthenticatedRequest, origin: string | undefined): { token: string; client: "web" | "mobile" } {
    if (body?.refreshToken) {
      return { token: body.refreshToken, client: "mobile" };
    }
    this.requireBrowserOrigin(origin);
    const token = this.cookieCredential(request, origin);
    if (!token) throw new UnauthorizedException("Refresh credential required");
    return { token, client: "web" };
  }

  private response(session: IssuedSession, client: "web" | "mobile"): { data: Omit<IssuedSession, "refreshToken"> & { refreshToken?: string } } {
    const { refreshToken, ...payload } = session;
    return { data: client === "mobile" ? { ...payload, refreshToken } : payload };
  }

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Login; browser uses HttpOnly cookie, mobile receives refreshToken" })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({ status: 401, description: "Invalid credentials" })
  @ApiResponse({ status: 429, description: "Rate limited" })
  async login(@Body() body: LoginDto, @Headers("origin") origin: string | undefined,
    @Res({ passthrough: true }) res: Response): Promise<{ data: Omit<IssuedSession, "refreshToken"> & { refreshToken?: string } }> {
    const client = body.client ?? "web";
    if (client === "web" && origin) this.requireBrowserOrigin(origin);
    const session = await this.auth.login(body.username, body.password, client === "web" ? origin : undefined);
    if (client === "web") this.setRefreshCookie(res, session.refreshToken, origin);
    return this.response(session, client);
  }

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ required: false, type: RefreshDto })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({ status: 401, description: "Missing, invalid, expired, or replayed token" })
  async refresh(@Body() body: RefreshDto, @Req() req: AuthenticatedRequest,
    @Headers("origin") origin: string | undefined,
    @Res({ passthrough: true }) res: Response): Promise<{ data: Omit<IssuedSession, "refreshToken"> & { refreshToken?: string } }> {
    const credential = this.credential(body, req, origin);
    const session = await this.auth.refresh(credential.token, credential.client === "web" ? origin : undefined);
    if (credential.client === "web") this.setRefreshCookie(res, session.refreshToken, origin);
    return this.response(session, credential.client);
  }

  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ required: false, type: RefreshDto })
  @ApiResponse({ status: 200, description: "Session revoked" })
  async logout(@Body() body: RefreshDto, @Req() req: AuthenticatedRequest,
    @Headers("origin") origin: string | undefined,
    @Res({ passthrough: true }) res: Response): Promise<{ data: { loggedOut: boolean } }> {
    // Mobile clients send refreshToken explicitly. Browser clients prefer the
    // HttpOnly refresh cookie, but a different-site localhost UI may not have it.
    if (body?.refreshToken) {
      await this.auth.logout(body.refreshToken);
    } else {
      this.requireBrowserOrigin(origin);
      const cookie = this.cookieCredential(req, origin);
      const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (bearer) {
        // Prefer the current authenticated browser session over a stale cookie.
        // No new privilege is granted: authenticate() verifies the bearer
        // and active DB session before revocation.
        await this.auth.logoutAccessSession(bearer, origin);
      } else if (cookie) {
        await this.auth.logout(cookie, origin);
      } else {
        throw new UnauthorizedException("Logout session credential required");
      }
      this.clearRefreshCookie(res, origin);
    }
    return { data: { loggedOut: true } };
  }

  @AllowAuthenticated()
  @AllowInitialPassword()
  @Get("me")
  @ApiBearerAuth()
  @ApiResponse({ status: 200, type: MeResponseDto })
  @ApiResponse({ status: 401, description: "Authentication required" })
  me(@Req() req: AuthenticatedRequest): MeResponseDto {
    if (!req.principal) throw new UnauthorizedException();
    return { data: {
      id: req.principal.id,
      role: req.principal.role,
      restaurantId: req.principal.restaurantId,
      branchId: req.principal.branchId,
      department: req.principal.department,
      mustChangePassword: req.principal.mustChangePassword,
    } };
  }

  @Roles("RESTAURANT_OWNER", "EMPLOYEE")
  @AllowInitialPassword()
  @Get("restaurant-identity")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get branding of the authenticated user's restaurant" })
  @ApiResponse({ status: 200, type: AuthenticatedRestaurantIdentityResponseDto })
  @ApiResponse({ status: 401, description: "Authentication required" })
  @ApiResponse({ status: 403, description: "Insufficient permissions or restaurant unavailable" })
  async restaurantIdentity(@Req() req: AuthenticatedRequest): Promise<AuthenticatedRestaurantIdentityResponseDto> {
    if (!req.principal) throw new UnauthorizedException();
    return { data: await this.auth.restaurantIdentity(req.principal) };
  }

  @AllowAuthenticated()
  @AllowInitialPassword()
  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiResponse({ status: 200, type: ChangedResponseDto })
  @ApiResponse({ status: 403, description: "Incorrect current password" })
  async changePassword(@Req() req: AuthenticatedRequest, @Body() body: ChangePasswordDto): Promise<ChangedResponseDto> {
    if (!req.principal) throw new UnauthorizedException();
    await this.auth.changePassword(req.principal, body.currentPassword, body.newPassword, req.requestId);
    return { data: { changed: true } };
  }
}
