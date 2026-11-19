import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql } from "kysely";
import { DatabaseService } from "../../../database/database.service";

@Injectable()
export class LoginThrottleService {
  constructor(private readonly database: DatabaseService) {}

  private key(username: string): string {
    return createHash("sha256").update(username.toLowerCase(), "utf8").digest("hex");
  }

  async assertAllowed(username: string): Promise<void> {
    const record = await this.database.db.selectFrom("auth_login_attempts")
      .select("blocked_until")
      .where("identity_hash", "=", this.key(username))
      .executeTakeFirst();
    if (record?.blocked_until && record.blocked_until > new Date()) {
      throw new HttpException({ code: "RATE_LIMITED", message: "Too many login attempts" }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async recordFailure(username: string): Promise<void> {
    const identityHash = this.key(username);
    await sql`
      INSERT INTO auth_login_attempts (identity_hash, attempts, window_started_at, blocked_until)
      VALUES (${identityHash}, 1, now(), NULL)
      ON CONFLICT (identity_hash) DO UPDATE SET
        attempts = CASE
          WHEN auth_login_attempts.window_started_at < now() - interval '15 minutes'
            OR auth_login_attempts.blocked_until < now() THEN 1
          ELSE auth_login_attempts.attempts + 1
        END,
        window_started_at = CASE
          WHEN auth_login_attempts.window_started_at < now() - interval '15 minutes'
            OR auth_login_attempts.blocked_until < now() THEN now()
          ELSE auth_login_attempts.window_started_at
        END,
        blocked_until = CASE
          WHEN auth_login_attempts.window_started_at < now() - interval '15 minutes'
            OR auth_login_attempts.blocked_until < now() THEN NULL
          WHEN auth_login_attempts.attempts + 1 >= 5 THEN now() + interval '15 minutes'
          ELSE auth_login_attempts.blocked_until
        END
    `.execute(this.database.db);
  }

  async clear(username: string): Promise<void> {
    await this.database.db.deleteFrom("auth_login_attempts")
      .where("identity_hash", "=", this.key(username))
      .execute();
  }
}
