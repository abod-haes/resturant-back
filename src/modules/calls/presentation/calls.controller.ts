import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe,
  Patch, Post, Query, Req, UnauthorizedException,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../../../common/auth/authenticated-request";
import { BranchScope, Public, Roles } from "../../../common/auth/policy.decorators";
import { CallsService } from "../application/calls.service";
import { RoutingService } from "../application/routing.service";
import {
  BranchRoutingEnvelopeDto, BranchRoutingPatchDto, CallEnvelopeDto, CallPageDto, CreateCallDto,
  ListCallsQueryDto, OwnerAlertsEnvelopeDto, RestaurantRoutingPatchDto, RoutingEnvelopeDto,
} from "./calls.dto";

function principal(req: AuthenticatedRequest) {
  if (!req.principal) throw new UnauthorizedException();
  return req.principal;
}
const uuid = () => new ParseUUIDPipe({ version: "4" });

@ApiTags("Public service calls")
@Public()
@Controller("public/calls")
export class PublicCallsController {
  constructor(private readonly calls: CallsService) {}
  @Post() @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Atomic idempotent notification-only call; never claims device delivery" })
  @ApiOkResponse({ type: CallEnvelopeDto })
  async create(@Body() body: CreateCallDto): Promise<CallEnvelopeDto> {
    return { data: await this.calls.submit(body) };
  }
}

@ApiTags("Employee call inbox")
@ApiBearerAuth()
@Roles("EMPLOYEE")
@Controller("employee/calls")
export class EmployeeCallsController {
  constructor(private readonly calls: CallsService) {}
  @Get() @ApiOkResponse({ type: CallPageDto })
  async history(@Req() req: AuthenticatedRequest, @Query() query: ListCallsQueryDto): Promise<CallPageDto> {
    return this.calls.employeeCalls(principal(req), query);
  }
}

@ApiTags("Owner calls and alerts")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@Controller("owner")
export class OwnerCallsController {
  constructor(private readonly calls: CallsService) {}
  @Get("calls") @ApiOkResponse({ type: CallPageDto })
  async history(@Req() req: AuthenticatedRequest, @Query() query: ListCallsQueryDto) {
    return this.calls.ownerCalls(principal(req), query);
  }
  @Get("alerts") @ApiOkResponse({ type: OwnerAlertsEnvelopeDto })
  async alerts(@Req() req: AuthenticatedRequest, @Query() query: ListCallsQueryDto): Promise<OwnerAlertsEnvelopeDto> {
    return { data: await this.calls.ownerAlerts(principal(req), query.limit) };
  }
  @Post("alerts/:id/read") @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark persisted no-staff owner alert as read" })
  async markRead(@Param("id", uuid()) id: string, @Req() req: AuthenticatedRequest) {
    return { data: await this.calls.markAlertRead(principal(req), id) };
  }
}

@ApiTags("Owner routing settings")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@Controller("owner/call-routing")
export class RestaurantRoutingController {
  constructor(private readonly routing: RoutingService) {}
  @Get() @ApiOkResponse({ type: RoutingEnvelopeDto })
  async get(@Req() req: AuthenticatedRequest): Promise<RoutingEnvelopeDto> {
    return { data: await this.routing.getRestaurant(principal(req)) };
  }
  @Patch() @ApiOkResponse({ type: RoutingEnvelopeDto })
  async patch(@Body() body: RestaurantRoutingPatchDto, @Req() req: AuthenticatedRequest): Promise<RoutingEnvelopeDto> {
    return { data: await this.routing.updateRestaurant(principal(req), body.routingMode, req.requestId) };
  }
}

@ApiTags("Owner branch routing settings")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@BranchScope("branchId")
@Controller("owner/branches/:branchId/call-routing")
export class BranchRoutingController {
  constructor(private readonly routing: RoutingService) {}
  @Get() @ApiOkResponse({ type: BranchRoutingEnvelopeDto })
  async get(@Param("branchId", uuid()) branchId: string,
    @Req() req: AuthenticatedRequest): Promise<BranchRoutingEnvelopeDto> {
    return { data: await this.routing.getBranch(principal(req), branchId) };
  }
  @Patch() @ApiOkResponse({ type: BranchRoutingEnvelopeDto })
  async patch(@Param("branchId", uuid()) branchId: string,
    @Body() body: BranchRoutingPatchDto, @Req() req: AuthenticatedRequest): Promise<BranchRoutingEnvelopeDto> {
    return { data: await this.routing.updateBranch(principal(req), branchId, body, req.requestId) };
  }
}
