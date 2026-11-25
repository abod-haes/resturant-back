export const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const reserved = new Set(["www","api","admin","dashboard","mail","ftp","smtp","resturen","resturen-admin","resturen-customer","resturen-api","nebra-admin","test-restaurant"]);
export function isAssignableSubdomain(value: string): boolean {
  return SUBDOMAIN_PATTERN.test(value) && !reserved.has(value);
}

/** Browser Origin is a routing hint, never a replacement for authenticated identity. */
export function subdomainFromOrigin(origin: string | undefined, baseDomain: string | null | undefined): string | null {
  if (!origin || !baseDomain) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin || url.port) return null;
    const suffix = "." + baseDomain;
    if (!url.hostname.endsWith(suffix)) return null;
    const label = url.hostname.slice(0, -suffix.length);
    return isAssignableSubdomain(label) ? label : null;
  } catch { return null; }
}
