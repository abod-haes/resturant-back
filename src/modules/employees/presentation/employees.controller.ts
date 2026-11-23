import { ParsePostgresUuidPipe } from "../../../common/http/parse-postgres-uuid.pipe";
import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UnauthorizedException,
} from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../../../common/auth/authenticated-request";
import { Roles } from "../../../common/auth/policy.decorators";
import { EmployeesService } from "../application/employees.service";
import {
  CreateEmployeeDto, EmployeeListResponseDto, EmployeeResponseDto, ListEmployeesQueryDto,
  PatchEmployeeDto, ResetEmployeePasswordDto, ShiftEndResponseDto, ShiftResponseDto,
} from "./employees.dto";

function principal(req: AuthenticatedRequest) {
  if (!req.principal) throw new UnauthorizedException();
  return req.principal;
}
const uuid = () => new ParsePostgresUuidPipe();

@ApiTags("Owner employees")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@Controller("owner/employees")
export class OwnerEmployeesController {
  constructor(private readonly service: EmployeesService) {}
  @Get() @ApiOkResponse({ type: EmployeeListResponseDto })
  async list(@Query() query: ListEmployeesQueryDto, @Req() req: AuthenticatedRequest): Promise<EmployeeListResponseDto> {
    return this.service.list(query, principal(req));
  }
  @Post() @ApiCreatedResponse({ type: EmployeeResponseDto })
  async create(@Body() body: CreateEmployeeDto, @Req() req: AuthenticatedRequest): Promise<EmployeeResponseDto> {
    return { data: await this.service.create(body, principal(req), req.requestId) };
  }
  @Patch(":id") @ApiOkResponse({ type: EmployeeResponseDto })
  async patch(@Param("id", uuid()) id: string, @Body() body: PatchEmployeeDto,
    @Req() req: AuthenticatedRequest): Promise<EmployeeResponseDto> {
    return { data: await this.service.patch(id, body, principal(req), req.requestId) };
  }
  @Delete(":id")
  @ApiOperation({ summary: "Archive employee, revoke auth, close shift and free plan quota" })
  async archive(@Param("id", uuid()) id: string, @Req() req: AuthenticatedRequest) {
    return { data: await this.service.archive(id, principal(req), req.requestId) };
  }
  @Post(":id/reset-password") @HttpCode(HttpStatus.OK)
  async resetPassword(@Param("id", uuid()) id: string, @Body() body: ResetEmployeePasswordDto,
    @Req() req: AuthenticatedRequest) {
    return { data: await this.service.resetPassword(id, body.initialPassword, principal(req), req.requestId) };
  }
  @Post(":id/end-shift") @HttpCode(HttpStatus.OK) @ApiOkResponse({ type: ShiftEndResponseDto })
  async endShift(@Param("id", uuid()) id: string, @Req() req: AuthenticatedRequest): Promise<ShiftEndResponseDto> {
    return { data: await this.service.forceEndShift(id, principal(req), req.requestId) };
  }
}

@ApiTags("Employee shifts")
@ApiBearerAuth()
@Roles("EMPLOYEE")
@Controller("employee/shifts")
export class EmployeeShiftsController {
  constructor(private readonly service: EmployeesService) {}
  @Post("start") @ApiCreatedResponse({ type: ShiftEndResponseDto })
  async start(@Req() req: AuthenticatedRequest): Promise<ShiftEndResponseDto> {
    return { data: await this.service.startShift(principal(req)) };
  }
  @Get("current") @ApiOkResponse({ type: ShiftResponseDto })
  async current(@Req() req: AuthenticatedRequest): Promise<ShiftResponseDto> {
    return { data: await this.service.currentShift(principal(req)) };
  }
  @Post("end") @HttpCode(HttpStatus.OK) @ApiOkResponse({ type: ShiftEndResponseDto })
  async end(@Req() req: AuthenticatedRequest): Promise<ShiftEndResponseDto> {
    return { data: await this.service.endShift(principal(req)) };
  }
}
