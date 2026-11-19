import { Inject, Injectable, OnApplicationShutdown } from "@nestjs/common";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { RUNTIME_CONFIG, type RuntimeConfig } from "../common/config/runtime-config";
import type { DatabaseTables } from "./database.types";

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly pool: Pool;
  readonly db: Kysely<DatabaseTables>;

  constructor(@Inject(RUNTIME_CONFIG) config: RuntimeConfig) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      connectionTimeoutMillis: config.databaseConnectTimeoutMs,
      max: 10,
    });
    this.db = new Kysely<DatabaseTables>({
      dialect: new PostgresDialect({ pool: this.pool }),
    });
  }

  async ping(): Promise<void> {
    await sql`SELECT 1`.execute(this.db);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
