import { NotFoundException } from "@nestjs/common";
import { subdomainFromOrigin } from "./subdomain";
export function assertPublicTenant(origin: string | undefined, baseDomain: string | null | undefined, row: { restaurant_subdomain: string | null; restaurant_domain_status: "pending" | "ready" }): void {
  const tenant = subdomainFromOrigin(origin, baseDomain);
  if (tenant && (tenant !== row.restaurant_subdomain || row.restaurant_domain_status !== "ready")) {
    throw new NotFoundException("Resource not found");
  }
}
