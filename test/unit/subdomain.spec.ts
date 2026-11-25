import { isAssignableSubdomain } from "../../src/common/tenancy/subdomain";

describe("restaurant subdomain", () => {
  it.each(["alsham", "a", "pizza-2"])("accepts %s", value => expect(isAssignableSubdomain(value)).toBe(true));
  it.each(["", "-abc", "abc-", "a.b", "A", "مطعم", "api", "resturen-api", "a".repeat(64)])("rejects %s", value => expect(isAssignableSubdomain(value)).toBe(false));
});
