import { Body, Controller, Delete, Param, ParseUUIDPipe, Post, Req, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../../../common/auth/authenticated-request";
import { Roles } from "../../../common/auth/policy.decorators";
import { WebDeviceRegistryService } from "../application/web-device-registry.service";
import { RegisterWebPushDto, WebPushDeviceResponseDto } from "./web-push.dto";
@ApiTags("Employee web push")
@ApiBearerAuth()
@Roles("EMPLOYEE")
@Controller("employee/web-push/subscriptions")
export class WebPushController {
 constructor(private readonly registry:WebDeviceRegistryService){}
 @Post() @ApiCreatedResponse({type:WebPushDeviceResponseDto})
 async register(@Req() req:AuthenticatedRequest,@Body() payload:RegisterWebPushDto):Promise<WebPushDeviceResponseDto>{
  if(!req.principal)throw new UnauthorizedException();
  return {data:await this.registry.register(req.principal,payload)};
 }
 @Delete(":id")
 async unregister(@Req() req:AuthenticatedRequest,@Param("id",new ParseUUIDPipe({version:"4"})) id:string){
  if(!req.principal)throw new UnauthorizedException();
  return {data:await this.registry.unregister(req.principal,id)};
 }
}
