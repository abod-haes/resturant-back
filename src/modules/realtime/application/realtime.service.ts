import { ForbiddenException, Injectable, UnauthorizedException, type MessageEvent } from "@nestjs/common";
import { concatMap, defer, from, mergeMap, takeUntil, timer, type Observable } from "rxjs";
import { DatabaseService } from "../../../database/database.service";
import type { AuthPrincipal } from "../../../common/auth/principal";
import { requireOperationalEntitlements } from "../../../common/subscription/operational-entitlement";
import { AuthService } from "../../auth";

const POLL_MS = 2000;
const CONNECTION_MS = 5 * 60 * 1000;
const BATCH_SIZE = 100;

@Injectable()
export class RealtimeService {
  constructor(private readonly db: DatabaseService, private readonly auth: AuthService) {}

  /**
   * One cursor per connection, validated on every poll. The tenant counter is
   * transactionally serialized, so reconnecting after sequence N cannot skip
   * an event with sequence <= N that commits later.
   * Read from DB on every instance; no sticky sessions or in-memory fanout.
   */
  stream(principal: AuthPrincipal, bearer: string, after: number): Observable<MessageEvent> {
    const restaurantId = principal.restaurantId;
    if (!restaurantId || !["RESTAURANT_OWNER", "EMPLOYEE"].includes(principal.role)) {
      throw new ForbiddenException("Restaurant access required");
    }
    return defer(() => {
      let cursor = after;
      return timer(0, POLL_MS).pipe(
        concatMap(async () => {
          const active = await this.auth.authenticate(bearer);
          if (active.id !== principal.id || active.sessionId !== principal.sessionId ||
            active.role !== principal.role || active.restaurantId !== restaurantId ||
            (principal.role === "EMPLOYEE" && active.branchId !== principal.branchId)) {
            throw new UnauthorizedException("Session changed");
          }
          await requireOperationalEntitlements(this.db.db, restaurantId);
          let query = this.db.db.selectFrom("realtime_events").selectAll()
            .where("restaurant_id", "=", restaurantId)
            .where("sequence", ">", cursor);
          if (principal.role === "EMPLOYEE") {
            query = query.where("recipient_user_id", "=", principal.id).where("branch_id", "=", principal.branchId!);
          } else {
            query = query.where("recipient_user_id", "is", null);
          }
          const rows = await query.orderBy("sequence", "asc").limit(BATCH_SIZE).execute();
          if (!rows.length) {
            return [{ type: "heartbeat", data: {} } satisfies MessageEvent];
          }
          return rows.map(row => {
            const sequence = Number(row.sequence);
            cursor = Math.max(cursor, sequence);
            return {
              id: String(sequence), type: row.event_type,
              data: { eventId: row.id, eventType: row.event_type,
                occurredAt: row.created_at.toISOString(), branchId: row.branch_id,
                payload: row.payload },
            } satisfies MessageEvent;
          });
        }),
        mergeMap(events => from(events)),
        takeUntil(timer(CONNECTION_MS)),
      );
    });
  }
}
