import { Controller, Header, Headers, Query, Req, Sse, UnauthorizedException, type MessageEvent } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from "@nestjs/swagger";
import type { Observable } from "rxjs";
import type { AuthenticatedRequest } from "../../../common/auth/authenticated-request";
import { Roles } from "../../../common/auth/policy.decorators";
import { RealtimeService } from "../application/realtime.service";
import { StreamQueryDto } from "./realtime.dto";

function requirePrincipal(req: AuthenticatedRequest) {
  if (!req.principal) throw new UnauthorizedException();
  return req.principal;
}
function bearerToken(req: AuthenticatedRequest): string {
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    throw new UnauthorizedException();
  }
  return authorization.slice(7);
}
function cursor(lastId: string | undefined, after: number | undefined): number {
  if (lastId !== undefined) {
    if (!/^\d{1,16}$/.test(lastId) || !Number.isSafeInteger(Number(lastId))) {
      throw new UnauthorizedException("Invalid event resume cursor");
    }
    return Number(lastId);
  }
  return after ?? 0;
}

@ApiTags("Realtime SSE")
@ApiBearerAuth()
@Controller()
export class RealtimeController {
  constructor(private readonly events: RealtimeService) {}

  @Roles("RESTAURANT_OWNER")
  @Sse("owner/events")
  @Header("Cache-Control", "no-store")
  @Header("X-Accel-Buffering", "no")
  @ApiProduces("text/event-stream")
  @ApiOperation({ summary: "Owner tenant-scoped SSE events; Authorization bearer required; reconnect by Last-Event-ID" })
  owner(@Req() req: AuthenticatedRequest, @Query() query: StreamQueryDto,
    @Headers("last-event-id") lastId?: string): Observable<MessageEvent> {
    return this.events.stream(requirePrincipal(req), bearerToken(req), cursor(lastId, query.after));
  }

  @Roles("EMPLOYEE")
  @Sse("employee/events")
  @Header("Cache-Control", "no-store")
  @Header("X-Accel-Buffering", "no")
  @ApiProduces("text/event-stream")
  @ApiOperation({ summary: "Employee recipient-scoped SSE events; requires authenticated bearer; 5-minute connection lifetime" })
  employee(@Req() req: AuthenticatedRequest, @Query() query: StreamQueryDto,
    @Headers("last-event-id") lastId?: string): Observable<MessageEvent> {
    return this.events.stream(requirePrincipal(req), bearerToken(req), cursor(lastId, query.after));
  }
}
