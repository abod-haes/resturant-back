import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { BranchScope, Roles } from "../../../common/auth/policy.decorators";
import type { AuthenticatedRequest } from "../../../common/auth/authenticated-request";
import { WorkforceService } from "../application/workforce.service";
import {
  CreateEmployeeDto, EmployeeEnvelopeDto, EmployeeListEnvelopeDto, EmployeePageQueryDto, ShiftEnvelopeDto,
} from "./workforce.dto";

function principal(req: AuthenticatedRequest) {
  if (!req.principal) throw new UnauthorizedException();
  return req.principal;
}
const uuid = () => new ParseUUIDPipe({ version: "4" });

@ApiTags("Owner employees")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@BranchScope("branchId")
@Controller("owner/branches/:branchId/employees")
export class OwnerEmployeesController {
  constructor(private readonly service: WorkforceService) {}
  @Post() @ApiCreatedResponse({ type: EmployeeEnvelopeDto })
  async create(@Param("branchId", uuid()) branchId: string, @Body() body: CreateEmployeeDto,
    @Req() req: AuthenticatedRequest): Promise<EmployeeEnvelopeDto> {
    return { data: await this.service.createEmployee(principal(req), branchId, body, req.requestId) };
  }
  @Get() @ApiOkResponse({ type: EmployeeListEnvelopeDto })
  async list(@Param("branchId", uuid()) branchId: string, @Query() query: EmployeePageQueryDto,
    @Req() req: AuthenticatedRequest): Promise<EmployeeListEnvelopeDto> {
    return this.service.listEmployees(principal(req), branchId, query);
  }
}

@ApiTags("Employee shifts")
@ApiBearerAuth()
@Roles("EMPLOYEE")
@Controller("employee/shifts")
export class EmployeeShiftsController {
  constructor(private readonly service: WorkforceService) {}
  @Post("start") @ApiCreatedResponse({ type: ShiftEnvelopeDto })
  async start(@Req() req: AuthenticatedRequest): Promise<ShiftEnvelopeDto> {
    return { data: await this.service.startShift(principal(req)) };
  }
  @Post("end") @HttpCode(HttpStatus.OK) @ApiOkResponse({ type: ShiftEnvelopeDto })
  async end(@Req() req: AuthenticatedRequest): Promise<ShiftEnvelopeDto> {
    return { data: await this.service.endShift(principal(req)) };
  }
  @Get("current") @ApiOkResponse({ type: ShiftEnvelopeDto })
  async current(@Req() req: AuthenticatedRequest): Promise<ShiftEnvelopeDto> {
    return { data: await this.service.currentShift(principal(req)) };
  }
}

@ApiTags("Owner employee shifts")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@Controller("owner/shifts")
export class OwnerShiftsController {
  constructor(private readonly service: WorkforceService) {}
  @Post(":id/force-end") @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "End any open shift belonging to this owner's restaurant" })
  @ApiOkResponse({ type: ShiftEnvelopeDto })
  async end(@Param("id", uuid()) id: string, @Req() req: AuthenticatedRequest): Promise<ShiftEnvelopeDto> {
    return { data: await this.service.forceEnd(principal(req), id, req.requestId) };
  }
}
