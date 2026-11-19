import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AdminAuditService } from "./application/admin-audit.service";
import { AdminAuditController } from "./presentation/admin-audit.controller";

@Module({
  imports: [DatabaseModule],
  providers: [AdminAuditService],
  controllers: [AdminAuditController],
})
export class AuditModule {}
