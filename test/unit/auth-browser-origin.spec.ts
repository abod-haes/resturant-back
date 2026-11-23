import { UnauthorizedException } from "@nestjs/common";
import { AuthController } from "../../src/modules/auth/presentation/auth.controller";
import type { AuthService, IssuedSession } from "../../src/modules/auth/application/auth.service";
import type { RuntimeConfig } from "../../src/common/config/runtime-config";
import type { Response } from "express";

const session: IssuedSession = {
  accessToken: "test-access-token",
  expiresAt: "2027-01-01T00:00:00.000Z",
  refreshToken: "test-refresh-token",
  user: {
    id: "8ad0c8ba-2663-47bd-b34a-dc2edcc71623",
    role: "PRIMARY_ADMIN",
    restaurantId: null,
    branchId: null,
    department: null,
    mustChangePassword: false,
  },
};

function controller(origins: string[]) {
  const auth = { login: jest.fn().mockResolvedValue(session) };
  const config = { corsOrigins: origins, nodeEnv: "test", authCrossSiteCookie: undefined } as unknown as RuntimeConfig;
  const instance = new AuthController(auth as unknown as AuthService, config);
  const res = { cookie: jest.fn() } as unknown as Response;
  return { instance, auth, res };
}

describe("browser origin policy", () => {
  it("accepts any browser HTTP origin when CORS_ORIGINS is *", async () => {
    const { instance, auth, res } = controller(["*"]);
    await expect(instance.login({ username: "platform.admin", password: "valid-password", client: "web" },
      "http://localhost:5173", res)).resolves.toHaveProperty("data.accessToken");
    await expect(instance.login({ username: "platform.admin", password: "valid-password", client: "web" },
      "https://dashboard.example.test", res)).resolves.toHaveProperty("data.accessToken");
    expect(auth.login).toHaveBeenCalledTimes(2);
  });

  it("sets secure partitioned refresh cookies only with explicit cross-site mode", async () => {
    const { instance, res } = controller(["*"]);
    const configured = instance as unknown as { config: RuntimeConfig };
    configured.config = {
      ...configured.config, nodeEnv: "production", authCrossSiteCookie: true,
    };
    await instance.login({ username: "platform.admin", password: "valid-password", client: "web" },
      "http://localhost:5173", res);
    expect(res.cookie).toHaveBeenCalledWith("restaurant_refresh", "test-refresh-token",
      expect.objectContaining({
        httpOnly: true, secure: true, sameSite: "none", partitioned: true,
        path: "/api/v1/auth",
      }));
  });

  it("keeps Strict SameSite cookies as the default policy", async () => {
    const { instance, res } = controller(["*"]);
    await instance.login({ username: "platform.admin", password: "valid-password", client: "web" },
      "http://localhost:5173", res);
    expect(res.cookie).toHaveBeenCalledWith("restaurant_refresh", "test-refresh-token",
      expect.objectContaining({ sameSite: "strict", partitioned: undefined }));
  });

  it("still rejects an unlisted origin in restrictive mode", async () => {
    const { instance, auth, res } = controller(["https://dashboard.example.test"]);
    await expect(instance.login({ username: "platform.admin", password: "valid-password", client: "web" },
      "http://localhost:5173", res)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.login).not.toHaveBeenCalled();
  });

  it("keeps Origin mandatory for refresh-cookie requests even in wildcard mode", () => {
    const { instance } = controller(["*"]);
    const req = { headers: { cookie: "restaurant_refresh=any" } };
    expect(() => (instance as unknown as { requireBrowserOrigin(origin?: string): void }).requireBrowserOrigin(undefined))
      .toThrow(UnauthorizedException);
    expect(req.headers.cookie).toBeDefined();
  });
});
