import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../../auth/presentation/auth.decorators";
import { DatabaseService } from "../../../database/database.service";

@Public()
@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get("live")
  @ApiOperation({ summary: "Process liveness (no dependencies)" })
  @ApiResponse({ status: 200, description: "HTTP process is alive" })
  live(): { data: { status: string } } {
    return { data: { status: "ok" } };
  }

  @Get("ready")
  @ApiOperation({ summary: "Readiness only if PostgreSQL responds" })
  @ApiResponse({ status: 200, description: "Database is reachable" })
  @ApiResponse({ status: 503, description: "Database is unavailable" })
  async ready(): Promise<{ data: { status: string; database: string } }> {
    try {
      await this.database.ping();
    } catch {
      throw new ServiceUnavailableException({
        code: "SERVICE_UNAVAILABLE",
        message: "Database is unavailable",
      });
    }
    return { data: { status: "ready", database: "up" } };
  }
}
