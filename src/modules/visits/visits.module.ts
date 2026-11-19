import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { VisitsService } from "./application/visits.service";
import { VisitsController } from "./presentation/visits.controller";

@Module({ imports: [DatabaseModule], providers: [VisitsService], controllers: [VisitsController] })
export class VisitsModule {}
