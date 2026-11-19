import { BadRequestException, Injectable } from "@nestjs/common";
import { DatabaseService } from "../../../database/database.service";
import { sql } from "kysely";
import type { AuthPrincipal } from "../../../common/auth/principal";
import type { ContactDto, ContactInputDto } from "../presentation/subscriptions.dto";

function validContact(contact: ContactInputDto): boolean {
  if (contact.type === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.value);
  return /^\+?[0-9]{6,15}$/.test(contact.value);
}

@Injectable()
export class RenewalContactsService {
  constructor(private readonly database: DatabaseService) {}

  async list(onlyEnabled: boolean): Promise<ContactDto[]> {
    let query = this.database.db.selectFrom("renewal_contacts")
      .select(["type", "label", "value", "is_enabled"]).orderBy("sort_order", "asc").orderBy("id", "asc");
    if (onlyEnabled) query = query.where("is_enabled", "=", true);
    const rows = await query.execute();
    return rows.map((row) => ({ type: row.type, label: row.label, value: row.value, enabled: row.is_enabled }));
  }

  async replace(contacts: ContactInputDto[], actor: AuthPrincipal, requestId?: string): Promise<ContactDto[]> {
    for (const contact of contacts) {
      if (!validContact(contact)) {
        throw new BadRequestException({ code: "VALIDATION_ERROR", message: "Invalid renewal contact format" });
      }
    }
    await this.database.db.transaction().execute(async (trx) => {
      // Serialize replacement across all API replicas; audit is atomic with the change.
      await sql`SELECT pg_advisory_xact_lock(168456, 20261121)`.execute(trx);
      await trx.deleteFrom("renewal_contacts").execute();
      for (const [index, contact] of contacts.entries()) {
        await trx.insertInto("renewal_contacts").values({
          type: contact.type, label: contact.label.trim(), value: contact.value.trim(),
          is_enabled: contact.enabled, sort_order: index,
        }).execute();
      }
      await trx.insertInto("audit_logs").values({
        actor_user_id: actor.id, restaurant_id: null,
        action: "renewal_contacts.updated", entity_type: "platform_settings", entity_id: null,
        request_id: requestId ?? null,
        metadata: { count: contacts.length, types: contacts.map((contact) => contact.type) },
      }).execute();
    });
    return this.list(false);
  }
}
