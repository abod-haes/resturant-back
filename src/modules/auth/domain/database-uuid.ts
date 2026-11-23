/**
 * PostgreSQL uuid columns can contain legacy 128-bit UUID strings that do not
 * advertise an RFC version/variant (including imported IDs).
 *
 * This ONLY validates the fixed hexadecimal database identifier shape. It is
 * NOT an authentication check: AuthService.authenticate additionally verifies
 * the JWT signature, session id/user id binding, revocation and active user.
 */
export function isDatabaseUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
}
