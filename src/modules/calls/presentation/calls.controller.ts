import { ParsePostgresUuidPipe } from "../../../common/http/parse-postgres-uuid.pipe";
import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req,
  Res, UnauthorizedException,
} from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../../../common/auth/authenticated-request";
import { BranchScope, Public, Roles } from "../../../common/auth/policy.decorators";
import { CallsService } from "../application/calls.service";
import { VisitsService } from "../application/visits.service";
import { CallSettingsService } from "../application/call-settings.service";
import {
  AlertsResponseDto, BranchCallSettingsDto, CallHistoryResponseDto, CallResponseDto, CreateCallDto,
  CreateVisitResponseDto, ListCallsQueryDto, RestaurantCallSettingsDto, SessionTokenDto,
  SettingsResponseDto, VisitStatusResponseDto,
} from "./calls.dto";

function principal(req: AuthenticatedRequest) {
  if (!req.principal) throw new UnauthorizedException();
  return req.principal;
}

@ApiTags("Customer visits")
@Public()
@Controller("public")
export class PublicVisitsController {
  constructor(private readonly visits: VisitsService, private readonly calls: CallsService) {}
  @Post("t/:qrToken/sessions")
  @ApiOperation({ summary: "Start a 4h idle visit from an active table QR; token returned once" })
  @ApiCreatedResponse({ type: CreateVisitResponseDto })
  async createVisit(@Param("qrToken") qrToken: string,
    @Res({ passthrough: true }) res: Response): Promise<CreateVisitResponseDto> {
    res.setHeader("Cache-Control", "no-store");
    return { data: await this.visits.create(qrToken) };
  }
  @Post("sessions/status") @HttpCode(HttpStatus.OK) @ApiOkResponse({ type: VisitStatusResponseDto })
  async status(@Body() body: SessionTokenDto,
    @Res({ passthrough: true }) res: Response): Promise<VisitStatusResponseDto> {
    res.setHeader("Cache-Control", "no-store");
    return { data: await this.visits.status(body.sessionToken) };
  }
  @Post("calls") @ApiCreatedResponse({ type: CallResponseDto })
  @ApiOperation({ summary: "First-call confirmation, atomic 10s table/type cooldown and idempotency" })
  async call(@Body() body: CreateCallDto,
    @Res({ passthrough: true }) res: Response): Promise<CallResponseDto> {
    res.setHeader("Cache-Control", "no-store");
    return { data: await this.calls.create(body) };
  }
}

@ApiTags("Owner call settings")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@Controller("owner/call-settings")
export class OwnerRestaurantCallSettingsController {
  constructor(private readonly settings: CallSettingsService) {}
  @Get() @ApiOkResponse({ type: SettingsResponseDto })
  async get(@Req() req: AuthenticatedRequest): Promise<SettingsResponseDto> {
    return { data: await this.settings.ownerRoot(principal(req)) };
  }
  @Patch() @ApiOkResponse({ type: SettingsResponseDto })
  async patch(@Body() body: RestaurantCallSettingsDto, @Req() req: AuthenticatedRequest): Promise<SettingsResponseDto> {
    return { data: await this.settings.updateRoot(principal(req), body, req.requestId) };
  }
}

@ApiTags("Owner branch call settings")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@BranchScope("branchId")
@Controller("owner/branches/:branchId/call-settings")
export class OwnerBranchCallSettingsController {
  constructor(private readonly settings: CallSettingsService) {}
  @Get() @ApiOkResponse({ type: SettingsResponseDto })
  async get(@Param("branchId", new ParsePostgresUuidPipe()) branchId: string,
    @Req() req: AuthenticatedRequest): Promise<SettingsResponseDto> {
    return { data: await this.settings.ownerBranch(principal(req), branchId) };
  }
  @Patch() @ApiOkResponse({ type: SettingsResponseDto })
  async patch(@Param("branchId", new ParsePostgresUuidPipe()) branchId: string,
    @Body() body: BranchCallSettingsDto, @Req() req: AuthenticatedRequest): Promise<SettingsResponseDto> {
    return { data: await this.settings.updateBranch(principal(req), branchId, body, req.requestId) };
  }
}

@ApiTags("Owner calls and alerts")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@Controller("owner")
export class OwnerCallsController {
  constructor(private readonly calls: CallsService) {}
  @Get("calls") @ApiOkResponse({ type: CallHistoryResponseDto })
  async history(@Query() query: ListCallsQueryDto, @Req() req: AuthenticatedRequest): Promise<CallHistoryResponseDto> {
    return this.calls.ownerHistory(principal(req), query);
  }
  @Get("alerts") @ApiOkResponse({ type: AlertsResponseDto })
  async alerts(@Query() query: ListCallsQueryDto, @Req() req: AuthenticatedRequest): Promise<AlertsResponseDto> {
    return this.calls.ownerAlerts(principal(req), query);
  }
}

@ApiTags("Employee call history")
@ApiBearerAuth()
@Roles("EMPLOYEE")
@Controller("employee/calls")
export class EmployeeCallsController {
  constructor(private readonly calls: CallsService) {}
  @Get() @ApiOkResponse({ type: CallHistoryResponseDto })
  async history(@Query() query: ListCallsQueryDto, @Req() req: AuthenticatedRequest): Promise<CallHistoryResponseDto> {
    return this.calls.employeeHistory(principal(req), query);
  }
}
