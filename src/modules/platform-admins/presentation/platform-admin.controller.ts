import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query,
  Req, UnauthorizedException,
} from "@nestjs/common";
import {
  ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiNotFoundResponse,
  ApiOkResponse, ApiOperation, ApiTags,
} from "@nestjs/swagger";
import { Roles } from "../../../common/auth/policy.decorators";
import type { AuthenticatedRequest } from "../../../common/auth/authenticated-request";
import { PlatformAdminService } from "../application/platform-admin.service";
import {
  CreatePlatformAdminDto, PlatformAdminListQueryDto, PlatformAdminListResponseDto,
  PlatformAdminResponseDto, PlatformAdminResetResponseDto,
  ResetPlatformAdminPasswordDto, UpdatePlatformAdminDto,
} from "./platform-admin.dto";

@ApiTags("Platform administrators")
@ApiBearerAuth()
@Roles("PRIMARY_ADMIN")
@Controller("admin/platform-admins")
export class PlatformAdminController {
  constructor(private readonly admins: PlatformAdminService) {}

  @Post()
  @ApiOperation({ summary: "Primary administrator creates a platform administrator with forced password change" })
  @ApiCreatedResponse({ type: PlatformAdminResponseDto })
  @ApiConflictResponse({ description: "PLATFORM_ADMIN_USERNAME_TAKEN" })
  create(@Body() dto: CreatePlatformAdminDto, @Req() request: AuthenticatedRequest): Promise<PlatformAdminResponseDto> {
    if (!request.principal) throw new UnauthorizedException();
    return this.admins.create(dto, request.principal, request.requestId).then(data => ({ data }));
  }

  @Get()
  @ApiOperation({ summary: "Primary-only paginated platform administrator list" })
  @ApiOkResponse({ type: PlatformAdminListResponseDto })
  list(@Query() query: PlatformAdminListQueryDto): Promise<PlatformAdminListResponseDto> {
    return this.admins.list(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Primary-only platform administrator details" })
  @ApiOkResponse({ type: PlatformAdminResponseDto })
  @ApiNotFoundResponse({ description: "Only PLATFORM_ADMIN accounts can be managed here" })
  async get(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string): Promise<PlatformAdminResponseDto> {
    return { data: await this.admins.get(id) };
  }

  @Patch(":id")
  @ApiOperation({ summary: "Rename or activate/deactivate an administrator; disable revokes sessions" })
  @ApiOkResponse({ type: PlatformAdminResponseDto })
  @ApiNotFoundResponse({ description: "Only PLATFORM_ADMIN accounts can be managed here" })
  async update(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() dto: UpdatePlatformAdminDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PlatformAdminResponseDto> {
    if (!request.principal) throw new UnauthorizedException();
    return { data: await this.admins.update(id, dto, request.principal, request.requestId) };
  }

  @Post(":id/reset-password")
  @ApiOperation({ summary: "Reset initial password, force change on login and revoke every session" })
  @ApiOkResponse({ type: PlatformAdminResetResponseDto })
  @ApiNotFoundResponse({ description: "Only PLATFORM_ADMIN accounts can be reset here" })
  async reset(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() dto: ResetPlatformAdminPasswordDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PlatformAdminResetResponseDto> {
    if (!request.principal) throw new UnauthorizedException();
    await this.admins.resetPassword(id, dto.initialPassword, request.principal, request.requestId);
    return { data: { reset: true } };
  }
}
