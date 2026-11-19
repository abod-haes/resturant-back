import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UnauthorizedException,
} from "@nestjs/common";
import {
  ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags,
} from "@nestjs/swagger";
import { Roles } from "../../../common/auth/policy.decorators";
import type { AuthenticatedRequest } from "../../../common/auth/authenticated-request";
import { BranchesService } from "../application/branches.service";
import { BranchCreateDto, BranchListResponseDto, BranchPageDto, BranchPatchDto, BranchResponseDto } from "./branch.dto";

@ApiTags("Owner branches")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@Controller("owner/branches")
export class BranchesController {
  constructor(private readonly service: BranchesService) {}
  private principal(request: AuthenticatedRequest) {
    if (!request.principal) throw new UnauthorizedException();
    return request.principal;
  }

  @Get() @ApiOkResponse({ type: BranchListResponseDto })
  async list(@Query() query: BranchPageDto, @Req() req: AuthenticatedRequest): Promise<BranchListResponseDto> {
    return this.service.list(this.principal(req), query);
  }

  @Post() @ApiOperation({ summary: "Add a tenant branch with transactionally enforced plan limit" })
  @ApiCreatedResponse({ type: BranchResponseDto })
  async create(@Body() body: BranchCreateDto, @Req() req: AuthenticatedRequest): Promise<BranchResponseDto> {
    return { data: await this.service.create(this.principal(req), body, req.requestId) };
  }

  @Get(":branchId") @ApiOkResponse({ type: BranchResponseDto })
  async get(@Param("branchId", new ParseUUIDPipe({ version: "4" })) id: string,
    @Req() req: AuthenticatedRequest): Promise<BranchResponseDto> {
    return { data: await this.service.get(this.principal(req), id) };
  }

  @Patch(":branchId") @ApiOkResponse({ type: BranchResponseDto })
  async patch(@Param("branchId", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() body: BranchPatchDto, @Req() req: AuthenticatedRequest): Promise<BranchResponseDto> {
    return { data: await this.service.patch(this.principal(req), id, body, req.requestId) };
  }
}
