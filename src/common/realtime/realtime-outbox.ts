import { sql, type Kysely, type Transaction } from "kysely";
import type { DatabaseTables, RealtimeEventType } from "../../database/database.types";

export interface PendingRealtimeEvent {
  readonly branchId: string;
  readonly recipientUserId: string | null;
  readonly type: RealtimeEventType;
  readonly payload: Record<string, unknown>;
}
type Db = Kysely<DatabaseTables> | Transaction<DatabaseTables>;

/**
 * Reserve a contiguous restaurant-scoped sequence inside the writing transaction.
 * The counter row remains locked until commit: an SSE cursor can never skip
 * a lower-sequence event that commits after a higher-sequence event.
 */
export async function appendRealtimeEvents(
  db: Db, restaurantId: string, items: readonly PendingRealtimeEvent[],
): Promise<void> {
  if (!items.length) return;
  const count = items.length;
  const counter = await db.insertInto("restaurant_event_counters")
    .values({ restaurant_id: restaurantId, next_sequence: count })
    .onConflict(oc => oc.column("restaurant_id")
      .doUpdateSet({ next_sequence: sql<number>`restaurant_event_counters.next_sequence + ${count}` }))
    .returning("next_sequence").executeTakeFirstOrThrow();
  const first = Number(counter.next_sequence) - count + 1;
  await db.insertInto("realtime_events")
    .values(items.map((event, index) => ({
      restaurant_id: restaurantId,
      sequence: first + index,
      branch_id: event.branchId,
      recipient_user_id: event.recipientUserId,
      event_type: event.type,
      payload: event.payload,
    }))).execute();
}
