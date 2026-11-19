import { Controller, Get, Query, Req, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../../../common/auth/authenticated-request";
import { Roles } from "../../../common/auth/policy.decorators";
import { CallAnalyticsService } from "../application/call-analytics.service";
import { CallAnalyticsQueryDto, CallAnalyticsResponseDto } from "./analytics.dto";

@ApiTags("Owner call analytics")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@Controller("owner/call-analytics")
export class CallAnalyticsController {
  constructor(private readonly service: CallAnalyticsService) {}
  @Get()
  @ApiOperation({ summary: "Aggregate call counts per UTC day; 1..90 days, analytics plan feature required" })
  @ApiOkResponse({ type: CallAnalyticsResponseDto })
  async report(@Req() req: AuthenticatedRequest,
    @Query() query: CallAnalyticsQueryDto): Promise<CallAnalyticsResponseDto> {
    if (!req.principal) throw new UnauthorizedException();
    return { data: await this.service.report(req.principal, query) };
  }
}
