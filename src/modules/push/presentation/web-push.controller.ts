import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Post, Req, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../../../common/auth/authenticated-request";
import { Roles } from "../../../common/auth/policy.decorators";
import { WebDeviceRegistryService } from "../application/web-device-registry.service";
import { RegisterWebPushDto, WebPushDeviceResponseDto } from "./web-push.dto";
import { RUNTIME_CONFIG, type RuntimeConfig } from "../../../common/config/runtime-config";
import { WebPushConfigResponseDto } from "./web-push.dto";
@ApiTags("Employee web push")
@ApiBearerAuth()
@Roles("EMPLOYEE")
@Controller("employee/web-push")
export class WebPushController {
 constructor(private readonly registry:WebDeviceRegistryService, @Inject(RUNTIME_CONFIG) private readonly config:RuntimeConfig){}
 @Get("config") @ApiOkResponse({type:WebPushConfigResponseDto})
 configView():WebPushConfigResponseDto {
  return {data:{enabled:!!this.config.webPush,publicKey:this.config.webPush?.publicKey ?? null}};
 }
 @Post("subscriptions") @ApiCreatedResponse({type:WebPushDeviceResponseDto})
 async register(@Req() req:AuthenticatedRequest,@Body() payload:RegisterWebPushDto):Promise<WebPushDeviceResponseDto>{
  if(!req.principal)throw new UnauthorizedException();
  return {data:await this.registry.register(req.principal,payload)};
 }
 @Delete("subscriptions/:id")
 async unregister(@Req() req:AuthenticatedRequest,@Param("id",new ParseUUIDPipe({version:"4"})) id:string){
  if(!req.principal)throw new UnauthorizedException();
  return {data:await this.registry.unregister(req.principal,id)};
 }
}
