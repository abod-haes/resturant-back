import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Post, Req, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags, ApiOperation, ApiParam, ApiUnauthorizedResponse, ApiForbiddenResponse, ApiBadRequestResponse, ApiConflictResponse, ApiServiceUnavailableResponse } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../../../common/auth/authenticated-request";
import { Roles } from "../../../common/auth/policy.decorators";
import { WebDeviceRegistryService } from "../application/web-device-registry.service";
import { RegisterWebPushDto, WebPushDeviceResponseDto } from "./web-push.dto";
import { RUNTIME_CONFIG, type RuntimeConfig } from "../../../common/config/runtime-config";
import { WebPushConfigResponseDto, WebPushUnregisteredResponseDto } from "./web-push.dto";
@ApiTags("Employee web push")
@ApiBearerAuth()
@ApiUnauthorizedResponse({description:"Authentication required"})
@ApiForbiddenResponse({description:"Employee access or operational entitlement required"})
@Roles("EMPLOYEE")
@Controller("employee/web-push")
export class WebPushController {
 constructor(private readonly registry:WebDeviceRegistryService, @Inject(RUNTIME_CONFIG) private readonly config:RuntimeConfig){}
 @ApiOperation({summary:"Get public Web Push configuration"})
 @Get("config") @ApiOkResponse({type:WebPushConfigResponseDto})
 configView():WebPushConfigResponseDto {
  return {data:{enabled:!!this.config.webPush,publicKey:this.config.webPush?.publicKey ?? null}};
 }
 @ApiOperation({summary:"Register browser push subscription for current employee session"})
 @ApiBadRequestResponse({description:"Invalid subscription"})
 @ApiConflictResponse({description:"Subscription ownership conflict or device limit"})
 @ApiServiceUnavailableResponse({description:"Web Push unavailable"})
 @Post("subscriptions") @ApiCreatedResponse({type:WebPushDeviceResponseDto})
 async register(@Req() req:AuthenticatedRequest,@Body() payload:RegisterWebPushDto):Promise<WebPushDeviceResponseDto>{
  if(!req.principal)throw new UnauthorizedException();
  return {data:await this.registry.register(req.principal,payload)};
 }
 @ApiOperation({summary:"Deactivate current session browser subscription"})
 @ApiParam({name:"id",schema:{type:"string",format:"uuid"}})
 @ApiBadRequestResponse({description:"Invalid subscription ID"})
 @ApiOkResponse({type:WebPushUnregisteredResponseDto})
 @Delete("subscriptions/:id")
 async unregister(@Req() req:AuthenticatedRequest,@Param("id",new ParseUUIDPipe({version:"4"})) id:string):Promise<WebPushUnregisteredResponseDto>{
  if(!req.principal)throw new UnauthorizedException();
  return {data:await this.registry.unregister(req.principal,id)};
 }
}
