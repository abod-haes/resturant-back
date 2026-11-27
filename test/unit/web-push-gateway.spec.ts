import { createECDH, randomBytes } from "node:crypto";
import * as webPush from "web-push";
import { parseRuntimeConfig } from "../../src/common/config/runtime-config";
import { WebPushGateway } from "../../src/modules/push/infrastructure/web-push.gateway";
jest.mock("web-push",()=>({sendNotification:jest.fn()}));
const send = jest.mocked(webPush.sendNotification);
const base={NODE_ENV:"test",DATABASE_URL:"postgresql://staff:test@localhost:5432/restaurant",AUTH_ACCESS_SECRET:"test-only-unit-secret-with-adequate-entropy-2026"};
const pair=createECDH("prime256v1");pair.generateKeys();
const config=parseRuntimeConfig({...base,WEB_PUSH_ENABLED:"true",PUSH_TOKEN_ENCRYPTION_KEY:"ab".repeat(32),WEB_PUSH_VAPID_PUBLIC_KEY:pair.getPublicKey().toString("base64url"),WEB_PUSH_VAPID_PRIVATE_KEY:Buffer.concat([Buffer.alloc(32-pair.getPrivateKey().length),pair.getPrivateKey()]).toString("base64url"),WEB_PUSH_VAPID_SUBJECT:"mailto:test@example.com"});
const subscription={endpoint:"https://fcm.googleapis.com/fcm/send/test",expirationTime:null,keys:{p256dh:pair.getPublicKey().toString("base64url"),auth:randomBytes(16).toString("base64url")}};
const message={callId:"call-1",branchId:"branch-1",tableId:"table-1",tableLabel:"طاولة 1",type:"waiter" as const};
describe("Web Push gateway without outbound network",()=>{
 beforeEach(()=>send.mockReset());
 it("accepts provider success and bounds TTL",async()=>{
  send.mockResolvedValue({statusCode:201,body:"",headers:{}});
  expect(await new WebPushGateway(config).send(subscription,message,300)).toEqual({ok:true});
  expect(send).toHaveBeenCalledWith(subscription,expect.any(String),expect.objectContaining({TTL:120,timeout:5000}));
 });
 it.each([404,410])("deactivates expired subscription %s",async status=>{
  send.mockRejectedValue({statusCode:status});
  expect(await new WebPushGateway(config).send(subscription,message,30)).toEqual({ok:false,errorCode:"WEB_PUSH_HTTP_"+status,retryable:false,deactivate:true});
 });
 it.each([429,503])("retries temporary status %s",async status=>{
  send.mockRejectedValue({statusCode:status});
  expect(await new WebPushGateway(config).send(subscription,message,30)).toMatchObject({ok:false,retryable:true,deactivate:false});
 });
 it("rejects disabled, expired and untrusted endpoints without sending",async()=>{
  expect(await new WebPushGateway(parseRuntimeConfig(base)).send(subscription,message,30)).toMatchObject({ok:false,errorCode:"WEB_PUSH_DISABLED"});
  expect(await new WebPushGateway(config).send(subscription,message,0)).toMatchObject({ok:false,errorCode:"CALL_EXPIRED"});
  expect(await new WebPushGateway(config).send({...subscription,endpoint:"https://example.com/push"},message,30)).toMatchObject({ok:false,errorCode:"WEB_SUBSCRIPTION_INVALID"});
  expect(send).not.toHaveBeenCalled();
 });
});
