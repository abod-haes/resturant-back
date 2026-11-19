import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { EmployeesService } from "./application/employees.service";
import { EmployeeShiftsController, OwnerEmployeesController } from "./presentation/employees.controller";

@Module({
  imports: [DatabaseModule],
  providers: [EmployeesService],
  controllers: [EmployeeShiftsController, OwnerEmployeesController],
})
export class EmployeesModule {}
