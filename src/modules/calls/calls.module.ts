import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { CallsService } from "./application/calls.service";
import { RoutingService } from "./application/routing.service";
import {
  BranchRoutingController, EmployeeCallsController, OwnerCallsController,
  PublicCallsController, RestaurantRoutingController,
} from "./presentation/calls.controller";

@Module({
  imports: [DatabaseModule],
  providers: [CallsService, RoutingService],
  controllers: [
    PublicCallsController, EmployeeCallsController, OwnerCallsController,
    RestaurantRoutingController, BranchRoutingController,
  ],
})
export class CallsModule {}
