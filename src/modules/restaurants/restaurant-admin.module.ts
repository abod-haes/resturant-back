import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { RestaurantAdminService } from "./application/restaurant-admin.service";
import { RestaurantAdminController } from "./presentation/restaurant-admin.controller";

@Module({
  imports: [DatabaseModule],
  controllers: [RestaurantAdminController],
  providers: [RestaurantAdminService],
})
export class RestaurantAdminModule {}
