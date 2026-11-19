import { Module } from "@nestjs/common";
import { RuntimeConfigModule } from "./common/config/runtime-config";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./modules/health/presentation/health.controller";

@Module({
  imports: [RuntimeConfigModule, DatabaseModule],
  controllers: [HealthController],
})
export class AppModule {}
