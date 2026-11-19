import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UnauthorizedException,
} from "@nestjs/common";
import {
  ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse,
  ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags,
} from "@nestjs/swagger";
import { Roles } from "../../../common/auth/policy.decorators";
import type { AuthenticatedRequest } from "../../../common/auth/authenticated-request";
import { RestaurantAdminService } from "../application/restaurant-admin.service";
import {
  CreateRestaurantDto, OnboardingResponseDto, RestaurantDetailsResponseDto,
  RestaurantListQueryDto, RestaurantListResponseDto, UpdateRestaurantDto,
} from "./restaurant-admin.dto";

const ADMIN_ROLES = ["PRIMARY_ADMIN", "PLATFORM_ADMIN"] as const;

@ApiTags("Platform restaurants")
@ApiBearerAuth()
@Roles(...ADMIN_ROLES)
@Controller("admin/restaurants")
export class RestaurantAdminController {
  constructor(private readonly service: RestaurantAdminService) {}

  @Post()
  @ApiOperation({ summary: "Create restaurant, first branch and owner atomically" })
  @ApiCreatedResponse({ type: OnboardingResponseDto })
  @ApiConflictResponse({ description: "OWNER_USERNAME_TAKEN" })
  async create(@Body() dto: CreateRestaurantDto, @Req() request: AuthenticatedRequest): Promise<OnboardingResponseDto> {
    if (!request.principal) throw new UnauthorizedException();
    return { data: await this.service.create(dto, request.principal, request.requestId) };
  }

  @Get()
  @ApiOperation({ summary: "List restaurants with stable keyset pagination, default 20 max 100" })
  @ApiOkResponse({ type: RestaurantListResponseDto })
  async list(@Query() query: RestaurantListQueryDto): Promise<RestaurantListResponseDto> {
    return this.service.list(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get restaurant and initial branch details" })
  @ApiOkResponse({ type: RestaurantDetailsResponseDto })
  @ApiNotFoundResponse({ description: "Restaurant not found" })
  async get(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string): Promise<RestaurantDetailsResponseDto> {
    return { data: await this.service.get(id) };
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update restaurant name or active state, audited" })
  @ApiOkResponse({ type: RestaurantDetailsResponseDto })
  @ApiNotFoundResponse({ description: "Restaurant not found" })
  async update(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() dto: UpdateRestaurantDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<RestaurantDetailsResponseDto> {
    if (!request.principal) throw new UnauthorizedException();
    return { data: await this.service.update(id, dto, request.principal, request.requestId) };
  }
}
