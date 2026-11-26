import { BadRequestException, Body, Controller, Patch, Req, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../../common/auth/policy.decorators";
import type { AuthenticatedRequest } from "../../../common/auth/authenticated-request";
import { BrandingPatchDto } from "../../../common/tenancy/branding.dto";
import { RestaurantAdminService } from "../application/restaurant-admin.service";
import { BrandingDto } from "../../../common/tenancy/branding.dto";
import { ApiProperty } from "@nestjs/swagger";
class OwnerIdentityDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) subdomain!: string | null;
  @ApiProperty({ type: BrandingDto }) branding!: BrandingDto;
}
class OwnerIdentityResponseDto { @ApiProperty({ type: OwnerIdentityDto }) data!: OwnerIdentityDto; }

@ApiTags("Owner branding")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@Controller("owner/restaurant/branding")
export class RestaurantOwnerBrandingController {
  constructor(private readonly service: RestaurantAdminService) {}

  @Patch()
  @ApiOkResponse({ type: OwnerIdentityResponseDto })
  async update(@Body() branding: BrandingPatchDto, @Req() request: AuthenticatedRequest): Promise<OwnerIdentityResponseDto> {
    const actor = request.principal;
    if (!actor?.restaurantId || actor.role !== "RESTAURANT_OWNER") throw new UnauthorizedException();
    if (branding.logoUrl != null) throw new BadRequestException("Use logoMediaId to attach a restaurant logo");
    const updated = await this.service.update(actor.restaurantId, { branding }, actor, request.requestId);
    return { data: { id: updated.id, name: updated.name, subdomain: updated.subdomain, branding: updated.branding } };
  }
}
