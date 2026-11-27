import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import * as webPush from "web-push";
import { RUNTIME_CONFIG, type RuntimeConfig } from "../../../common/config/runtime-config";
import { validateWebSubscription, type WebSubscription } from "../../../common/push/web-push-subscription";
import type { PushCallMessage } from "./expo-push.gateway";

export type WebPushResult = {ok:true} | {ok:false;errorCode:string;retryable:boolean;deactivate:boolean};
@Injectable()
export class WebPushGateway {
 constructor(@Inject(RUNTIME_CONFIG) private readonly config:RuntimeConfig){}
 async send(subscription:WebSubscription,message:PushCallMessage,ttlSeconds:number):Promise<WebPushResult>{
  const vapid=this.config.webPush;
  if(!vapid)return {ok:false,errorCode:"WEB_PUSH_DISABLED",retryable:false,deactivate:false};
  if(!validateWebSubscription(subscription))return {ok:false,errorCode:"WEB_SUBSCRIPTION_INVALID",retryable:false,deactivate:true};
  if(!Number.isFinite(ttlSeconds)||ttlSeconds<1)return {ok:false,errorCode:"CALL_EXPIRED",retryable:false,deactivate:false};
  try{
   const payload=JSON.stringify({eventType:"call.created",callId:message.callId,tag:"call-"+message.callId,title:message.type==="waiter"?"استدعاء نادل":"استدعاء أركيلة",body:"طلب جديد من "+message.tableLabel,type:message.type});
   await webPush.sendNotification(subscription,payload,{vapidDetails:vapid,TTL:Math.min(120,Math.floor(ttlSeconds)),urgency:"high",topic:createHash("sha256").update(message.callId).digest("base64url").slice(0,32),timeout:5000});
   return {ok:true};
  }catch(error:unknown){
   const status=typeof error==="object"&&error!==null&&"statusCode" in error&&typeof error.statusCode==="number"?error.statusCode:null;
   return {ok:false,errorCode:status===null?"WEB_PUSH_TEMPORARY":"WEB_PUSH_HTTP_"+status,retryable:status===null||status===429||status>=500,deactivate:status===404||status===410};
  }
 }
}
