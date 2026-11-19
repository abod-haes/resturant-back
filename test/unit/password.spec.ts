import { hashPassword, verifyPassword } from "../../src/modules/auth/domain/password";

describe("password hashing", () => {
  it("hashes with random salts and verifies in constant time", async () => {
    const password = "Very-Strong-Password_2026!";
    const a = await hashPassword(password);
    const b = await hashPassword(password);
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(await verifyPassword(password, a)).toBe(true);
    expect(await verifyPassword("Wrong-Password-2026!", a)).toBe(false);
  });

  it("rejects weak or invalid password hashes", async () => {
    await expect(hashPassword("short")).rejects.toThrow("Password");
    expect(await verifyPassword("anything", "plain-text")).toBe(false);
  });
});
