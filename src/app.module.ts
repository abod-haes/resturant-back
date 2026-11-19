import { Module } from "@nestjs/common";
import { RuntimeConfigModule } from "./common/config/runtime-config";
import { DatabaseModule } from "./database/database.module";
import { AuthModule } from "./modules/auth/presentation/auth.module";
import { HealthController } from "./modules/health/presentation/health.controller";

@Module({
  imports: [RuntimeConfigModule, DatabaseModule, AuthModule],
  controllers: [HealthController],
})
export class AppModule {}
