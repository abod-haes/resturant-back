import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { CallsService } from "./application/calls.service";
import { VisitsService } from "./application/visits.service";
import { CallSettingsService } from "./application/call-settings.service";
import {
  PublicVisitsController, OwnerRestaurantCallSettingsController, OwnerBranchCallSettingsController,
  OwnerCallsController, EmployeeCallsController,
} from "./presentation/calls.controller";

@Module({
  imports: [DatabaseModule],
  providers: [CallsService, VisitsService, CallSettingsService],
  controllers: [
    PublicVisitsController, OwnerRestaurantCallSettingsController, OwnerBranchCallSettingsController,
    OwnerCallsController, EmployeeCallsController,
  ],
})
export class CallsModule {}
