import { Module } from "@nestjs/common";
import { RuntimeConfigModule } from "./common/config/runtime-config";
import { DatabaseModule } from "./database/database.module";
import { AuthModule } from "./modules/auth/presentation/auth.module";
import { RestaurantAdminModule } from "./modules/restaurants/restaurant-admin.module";
import { SubscriptionsModule } from "./modules/subscriptions/subscriptions.module";
import { HealthController } from "./modules/health/presentation/health.controller";

@Module({
  imports: [RuntimeConfigModule, DatabaseModule, AuthModule, RestaurantAdminModule, SubscriptionsModule],
  controllers: [HealthController],
})
export class AppModule {}
