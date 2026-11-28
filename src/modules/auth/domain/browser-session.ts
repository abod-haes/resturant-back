import { createHash } from "node:crypto";
import { subdomainFromOrigin } from "../../../common/tenancy/subdomain";

export function browserApplication(origin?: string, baseDomain?: string | null): "admin" | "owner" | "employee" | null {
  if (!origin || !baseDomain) return null;
  try {
    const url = new URL(origin);
    if (url.origin !== origin || url.protocol !== "https:" || url.port) return null;
    if (url.hostname === "resturen-admin." + baseDomain || url.hostname === "admin." + baseDomain) return "admin";
    if (url.hostname === "resturen-employee." + baseDomain) return "employee";
    if (url.hostname === "resturen." + baseDomain || url.hostname === "dashboard." + baseDomain || subdomainFromOrigin(origin, baseDomain)) return "owner";
  } catch { /* Invalid origins are rejected by the controller. */ }
  return null;
}

/** Never reuse the legacy shared browser cookie. Scope local/custom origins independently. */
export function browserRefreshCookieName(origin?: string, baseDomain?: string | null): string {
  const application = browserApplication(origin, baseDomain) ?? "browser";
  const digest = createHash("sha256").update(origin ?? "no-origin").digest("hex").slice(0, 32);
  return "restaurant_" + application + "_refresh_" + digest;
}
