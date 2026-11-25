export const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const reserved = new Set(["www","api","admin","dashboard","mail","ftp","smtp","resturen","resturen-customer","resturen-api","nebra-admin","test-restaurant"]);
export function isAssignableSubdomain(value: string): boolean {
  return SUBDOMAIN_PATTERN.test(value) && !reserved.has(value);
}
