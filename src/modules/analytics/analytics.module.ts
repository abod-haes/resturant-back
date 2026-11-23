import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { CallAnalyticsService } from "./application/call-analytics.service";
import { CallAnalyticsController, OwnerOverviewController } from "./presentation/analytics.controller";

@Module({
  imports: [DatabaseModule],
  providers: [CallAnalyticsService],
  controllers: [CallAnalyticsController, OwnerOverviewController],
})
export class AnalyticsModule {}
