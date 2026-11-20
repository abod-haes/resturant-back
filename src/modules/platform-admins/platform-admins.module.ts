import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { PlatformAdminService } from "./application/platform-admin.service";
import { PlatformAdminController } from "./presentation/platform-admin.controller";

@Module({
  imports: [DatabaseModule],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService],
})
export class PlatformAdminsModule {}
