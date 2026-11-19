import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { FacilitiesService } from "./application/facilities.service";
import { TablesService } from "./application/tables.service";
import { QrService } from "./application/qr.service";
import { QrPrintService } from "./application/qr-print.service";
import {
  AreasController, FloorsController, TablesController,
  QrOwnerController, QrPrintController, PublicTableQrController,
} from "./presentation/tables.controller";

@Module({
  imports: [DatabaseModule],
  providers: [FacilitiesService, TablesService, QrService, QrPrintService],
  controllers: [
    AreasController, FloorsController, TablesController,
    QrOwnerController, QrPrintController, PublicTableQrController,
  ],
})
export class TablesModule {}
