import { Module } from "@nestjs/common";
import { RuntimeConfigModule } from "./common/config/runtime-config";
import { DatabaseModule } from "./database/database.module";
import { AuthModule } from "./modules/auth/presentation/auth.module";
import { RestaurantAdminModule } from "./modules/restaurants/restaurant-admin.module";
import { SubscriptionsModule } from "./modules/subscriptions/subscriptions.module";
import { BranchesModule } from "./modules/branches/branches.module";
import { MenuModule } from "./modules/menu/menu.module";
import { TablesModule } from "./modules/tables/tables.module";
import { EmployeesModule } from "./modules/employees/employees.module";
import { CallsModule } from "./modules/calls/calls.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";
import { PushModule } from "./modules/push/push.module";
import { MediaModule } from "./modules/media/media.module";
import { PlatformAdminsModule } from "./modules/platform-admins/platform-admins.module";
import { HealthController } from "./modules/health/presentation/health.controller";

@Module({
  imports: [RuntimeConfigModule, DatabaseModule, AuthModule, RestaurantAdminModule, SubscriptionsModule, BranchesModule, MenuModule, TablesModule, EmployeesModule, CallsModule, RealtimeModule, PushModule, MediaModule, PlatformAdminsModule],
  controllers: [HealthController],
})
export class AppModule {}
