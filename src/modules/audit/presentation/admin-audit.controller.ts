import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../../common/auth/policy.decorators";
import { AdminAuditService } from "../application/admin-audit.service";
import { AdminAuditQueryDto, AdminAuditResponseDto } from "./audit.dto";

@ApiTags("Platform audit")
@ApiBearerAuth()
@Roles("PRIMARY_ADMIN")
@Controller("admin/audit-logs")
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}
  @Get()
  @ApiOperation({ summary: "Primary administrator only; filtered keyset audit log, sensitive metadata excluded" })
  @ApiOkResponse({ type: AdminAuditResponseDto })
  list(@Query() query: AdminAuditQueryDto): Promise<AdminAuditResponseDto> {
    return this.audit.list(query);
  }
}
