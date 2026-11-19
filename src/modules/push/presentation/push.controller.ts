import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../../../common/auth/authenticated-request";
import { Roles } from "../../../common/auth/policy.decorators";
import { DeviceRegistryService } from "../application/device-registry.service";
import { PushDeviceResponseDto, PushDevicesResponseDto, RegisterPushDeviceDto } from "./push.dto";

function principal(req: AuthenticatedRequest) {
  if (!req.principal) throw new UnauthorizedException();
  return req.principal;
}
@ApiTags("Employee push devices")
@ApiBearerAuth()
@Roles("EMPLOYEE")
@Controller("employee/devices")
export class PushDevicesController {
  constructor(private readonly registry: DeviceRegistryService) {}
  @Get() @ApiOkResponse({ type: PushDevicesResponseDto })
  async list(@Req() req: AuthenticatedRequest): Promise<PushDevicesResponseDto> {
    return { data: await this.registry.list(principal(req)) };
  }
  @Post() @ApiCreatedResponse({ type: PushDeviceResponseDto })
  async register(@Req() req: AuthenticatedRequest, @Body() payload: RegisterPushDeviceDto): Promise<PushDeviceResponseDto> {
    return { data: await this.registry.register(principal(req), payload) };
  }
  @Delete(":id")
  async unregister(@Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) {
    return { data: await this.registry.unregister(principal(req), id) };
  }
}
