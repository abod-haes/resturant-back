import { Body, Controller, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../../common/auth/policy.decorators";
import { VisitsService } from "../application/visits.service";
import { SessionCredentialDto, VisitSessionEnvelopeDto, VisitStateEnvelopeDto } from "./visit.dto";

@ApiTags("Public QR visits")
@Public()
@Controller("public")
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Post("t/:qrToken/sessions")
  @ApiOperation({ summary: "Start a 4-hour idle-expiring anonymous table QR session" })
  @ApiCreatedResponse({ type: VisitSessionEnvelopeDto })
  async create(@Param("qrToken") qrToken: string): Promise<VisitSessionEnvelopeDto> {
    return { data: await this.visits.create(qrToken) };
  }

  @Post("sessions/heartbeat") @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Extend idle expiry only for active, unrevoked QR visits" })
  @ApiOkResponse({ type: VisitStateEnvelopeDto })
  async heartbeat(@Body() body: SessionCredentialDto): Promise<VisitStateEnvelopeDto> {
    return { data: await this.visits.heartbeat(body.sessionToken) };
  }
}
