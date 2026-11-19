import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { WorkforceService } from "./application/workforce.service";
import {
  EmployeeShiftsController, OwnerEmployeesController, OwnerShiftsController,
} from "./presentation/workforce.controller";

@Module({
  imports: [DatabaseModule],
  providers: [WorkforceService],
  controllers: [OwnerEmployeesController, EmployeeShiftsController, OwnerShiftsController],
})
export class WorkforceModule {}
