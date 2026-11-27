import { ConflictException, ForbiddenException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { sql } from "kysely";
import { DatabaseService } from "../../../database/database.service";
import type { AuthPrincipal } from "../../../common/auth/principal";
import { RUNTIME_CONFIG, type RuntimeConfig } from "../../../common/config/runtime-config";
import { requireOperationalEntitlements } from "../../../common/subscription/operational-entitlement";
import { validateWebSubscription, sealWebSubscription, webEndpointHash, type WebSubscription } from "../../../common/push/web-push-subscription";

@Injectable()
export class WebDeviceRegistryService {
 constructor(private readonly database: DatabaseService, @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}
 async register(principal: AuthPrincipal, subscription: WebSubscription) {
  if (principal.role !== "EMPLOYEE" || !principal.restaurantId || !principal.branchId || !principal.department || principal.mustChangePassword) throw new ForbiddenException();
  const key = this.config.pushTokenEncryptionKey;
  if (!key || !this.config.webPush) throw new ServiceUnavailableException("Web push not configured");
  if (!validateWebSubscription(subscription)) throw new ForbiddenException("Invalid web subscription");
  const hash = webEndpointHash(subscription.endpoint);
  const box = sealWebSubscription(subscription, key);
  const now = new Date();
  const restaurantId = principal.restaurantId;
  try {
   return await this.database.db.transaction().execute(async trx => {
    const user = await trx.selectFrom("users").select("id").where("id","=",principal.id).where("role","=","EMPLOYEE").where("restaurant_id","=",restaurantId).where("branch_id","=",principal.branchId).where("department","=",principal.department).where("is_active","=",true).where("archived_at","is",null).forUpdate().executeTakeFirst();
    if (!user) throw new ForbiddenException();
    const session = await trx.selectFrom("auth_sessions").select("id").where("id","=",principal.sessionId).where("user_id","=",principal.id).where("revoked_at","is",null).where("expires_at",">",now).executeTakeFirst();
    if (!session) throw new ForbiddenException();
    await requireOperationalEntitlements(trx,restaurantId,principal.department === "waiter" ? "waiter_calls" : "hookah_calls");
    // Expired credentials and revoked sessions must not consume device slots.
    await trx.updateTable("employee_push_devices").set({is_active:false})
      .where("user_id","=",principal.id).where("channel","=","web_push").where("is_active","=",true)
      .where(eb=>eb.or([
        eb("expires_at","<=",now),
        eb.not(eb.exists(eb.selectFrom("auth_sessions").select("id")
          .whereRef("auth_sessions.id","=","employee_push_devices.session_id")
          .whereRef("auth_sessions.user_id","=","employee_push_devices.user_id")
          .where("revoked_at","is",null).where("expires_at",">",now)))
      ])).execute();
    const current = await trx.selectFrom("employee_push_devices").selectAll().where("token_hash","=",hash).where("channel","=","web_push").forUpdate().executeTakeFirst();
    if (current && current.user_id !== principal.id) throw new ConflictException("Subscription belongs to another employee");
    const count = await trx.selectFrom("employee_push_devices").select(sql<number>`count(*)::int`.as("count")).where("user_id","=",principal.id).where("channel","=","web_push").where("is_active","=",true).executeTakeFirstOrThrow();
    if ((!current || !current.is_active) && count.count >= 5) throw new ConflictException("Web device limit reached");
    const values = {session_id:principal.sessionId,token_box:box,expires_at:subscription.expirationTime === null ? null : new Date(subscription.expirationTime),is_active:true,last_seen_at:now};
    const row = current ? await trx.updateTable("employee_push_devices").set(values).where("id","=",current.id).returning("id").executeTakeFirstOrThrow() : await trx.insertInto("employee_push_devices").values({...values,user_id:principal.id,channel:"web_push",platform:"web",token_hash:hash}).returning("id").executeTakeFirstOrThrow();
    return {id:row.id,isActive:true};
   });
  } catch(error:unknown) {
   if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") throw new ConflictException("Subscription already registered");
   throw error;
  }
 }
 async unregister(principal:AuthPrincipal,id:string) {
  if(principal.role !== "EMPLOYEE") throw new ForbiddenException();
  await this.database.db.updateTable("employee_push_devices").set({is_active:false}).where("id","=",id).where("user_id","=",principal.id).where("session_id","=",principal.sessionId).where("channel","=","web_push").execute();
  return {unregistered:true as const};
 }
}
