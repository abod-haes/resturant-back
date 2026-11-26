import { Body, Controller, Patch, Req, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../../common/auth/policy.decorators";
import type { AuthenticatedRequest } from "../../../common/auth/authenticated-request";
import { BrandingPatchDto } from "../../../common/tenancy/branding.dto";
import { RestaurantAdminService } from "../application/restaurant-admin.service";
import { RestaurantDetailsResponseDto } from "./restaurant-admin.dto";

@ApiTags("Owner branding")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@Controller("owner/restaurant/branding")
export class RestaurantOwnerBrandingController {
  constructor(private readonly service: RestaurantAdminService) {}

  @Patch()
  @ApiOkResponse({ type: RestaurantDetailsResponseDto })
  async update(@Body() branding: BrandingPatchDto, @Req() request: AuthenticatedRequest): Promise<RestaurantDetailsResponseDto> {
    const actor = request.principal;
    if (!actor?.restaurantId || actor.role !== "RESTAURANT_OWNER") throw new UnauthorizedException();
    return { data: await this.service.update(actor.restaurantId, { branding }, actor, request.requestId) };
  }
}
