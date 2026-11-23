import { isDatabaseUuid } from "../../src/modules/auth/domain/database-uuid";

describe("database UUID used by JWT principal validation", () => {
  it("accepts legacy PostgreSQL IDs even without RFC version/variant bits", () => {
    expect(isDatabaseUuid("803852bc-d9d5-96c4-f879-9648831f85cf")).toBe(true);
    expect(isDatabaseUuid("123e4567-e89b-42d3-a456-426614174000")).toBe(true);
  });
  it("still rejects malformed, truncated and nonhex identities", () => {
    expect(isDatabaseUuid("not-a-uuid")).toBe(false);
    expect(isDatabaseUuid("803852bc-d9d5-96c4-f879-9648831f85c")).toBe(false);
    expect(isDatabaseUuid("803852bc-d9d5-96c4-f879-9648831f85cx")).toBe(false);
    expect(isDatabaseUuid(null)).toBe(false);
  });
});
