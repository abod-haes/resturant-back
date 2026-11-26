import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { RestaurantAdminService } from "./application/restaurant-admin.service";
import { RestaurantAdminController } from "./presentation/restaurant-admin.controller";

import { RestaurantOwnerBrandingController } from "./presentation/restaurant-owner-branding.controller";

@Module({
  imports: [DatabaseModule],
  controllers: [RestaurantAdminController, RestaurantOwnerBrandingController],
  providers: [RestaurantAdminService],
})
export class RestaurantAdminModule {}
