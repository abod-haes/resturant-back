import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsUUID, Matches } from "class-validator";

export class CallAnalyticsQueryDto {
  @ApiPropertyOptional({ format: "date", description: "UTC inclusive start YYYY-MM-DD; requires to" })
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @ApiPropertyOptional({ format: "date", description: "UTC exclusive end YYYY-MM-DD; max 90 days" })
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @ApiPropertyOptional({ format: "uuid" }) @IsOptional() @IsUUID("4") branchId?: string;
}
export class CallAnalyticsTotalsDto {
  @ApiProperty() totalCalls!: number;
  @ApiProperty() waiterCalls!: number;
  @ApiProperty() hookahCalls!: number;
  @ApiProperty() routedCalls!: number;
  @ApiProperty() noStaffCalls!: number;
  @ApiProperty() distinctTables!: number;
}
export class CallAnalyticsDailyDto {
  @ApiProperty({ format: "date" }) date!: string;
  @ApiProperty() totalCalls!: number;
  @ApiProperty() waiterCalls!: number;
  @ApiProperty() hookahCalls!: number;
  @ApiProperty() routedCalls!: number;
  @ApiProperty() noStaffCalls!: number;
}
export class CallAnalyticsReportDto {
  @ApiProperty({ format: "date" }) from!: string;
  @ApiProperty({ format: "date" }) to!: string;
  @ApiProperty({ format: "uuid", nullable: true }) branchId!: string | null;
  @ApiProperty({ type: CallAnalyticsTotalsDto }) summary!: CallAnalyticsTotalsDto;
  @ApiProperty({ type: [CallAnalyticsDailyDto] }) daily!: CallAnalyticsDailyDto[];
}
export class CallAnalyticsResponseDto {
  @ApiProperty({ type: CallAnalyticsReportDto }) data!: CallAnalyticsReportDto;
}
