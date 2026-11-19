import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min,
} from "class-validator";
import type { CallRoutingMode, CallType, CallDeliveryState } from "../../../database/database.types";

export class RestaurantCallSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() waiterEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hookahEnabled?: boolean;
  @ApiPropertyOptional({ enum: ["all_on_shift","department_on_shift"] })
  @IsOptional() @IsIn(["all_on_shift","department_on_shift"]) routingMode?: CallRoutingMode;
  @ApiPropertyOptional({ minimum: 60, maximum: 1440 })
  @IsOptional() @IsInt() @Min(60) @Max(1440) shiftAutoEndMinutes?: number;
}
export class BranchCallSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() waiterEnabled?: boolean | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hookahEnabled?: boolean | null;
  @ApiPropertyOptional({ enum: ["all_on_shift","department_on_shift"] })
  @IsOptional() @IsIn(["all_on_shift","department_on_shift"]) routingMode?: CallRoutingMode | null;
}
export class EffectiveCallSettingsDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty() waiterEnabled!: boolean;
  @ApiProperty() hookahEnabled!: boolean;
  @ApiProperty({ enum: ["all_on_shift","department_on_shift"] }) routingMode!: CallRoutingMode;
  @ApiProperty() shiftAutoEndMinutes!: number;
}
export class SettingsResponseDto { @ApiProperty({ type: EffectiveCallSettingsDto }) data!: EffectiveCallSettingsDto; }
export class CreateVisitResponseDataDto {
  @ApiProperty({ writeOnly: true }) sessionToken!: string;
  @ApiProperty({ format: "date-time" }) expiresAt!: string;
  @ApiProperty() firstCallNeedsConfirmation!: boolean;
  @ApiProperty({ type: [String] }) availableCallTypes!: CallType[];
}
export class CreateVisitResponseDto { @ApiProperty({ type: CreateVisitResponseDataDto }) data!: CreateVisitResponseDataDto; }
export class VisitStatusDto {
  @ApiProperty() expiresAt!: string;
  @ApiProperty() firstCallNeedsConfirmation!: boolean;
  @ApiProperty({ type: [String] }) availableCallTypes!: CallType[];
}
export class VisitStatusResponseDto { @ApiProperty({ type: VisitStatusDto }) data!: VisitStatusDto; }
export class SessionTokenDto {
  @ApiProperty({ writeOnly: true }) @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/)
  sessionToken!: string;
}
export class CreateCallDto extends SessionTokenDto {
  @ApiProperty({ enum: ["waiter", "hookah"] }) @IsIn(["waiter","hookah"]) type!: CallType;
  @ApiProperty({ format: "uuid" }) @IsUUID("4") idempotencyKey!: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() confirmFirstCall?: boolean;
}
export class CallDataDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: ["waiter","hookah"] }) type!: CallType;
  @ApiProperty({ enum: ["queued","no_staff"] }) deliveryState!: CallDeliveryState;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty() recipientsCount!: number;
  @ApiProperty() ownerAlerted!: boolean;
  @ApiProperty() firstCallNeedsConfirmation!: boolean;
}
export class CallResponseDto { @ApiProperty({ type: CallDataDto }) data!: CallDataDto; }
export class ListCallsQueryDto {
  @ApiPropertyOptional({ format: "uuid" }) @IsOptional() @IsUUID("4") branchId?: string;
  @ApiPropertyOptional({ enum: ["waiter","hookah"] }) @IsOptional() @IsIn(["waiter","hookah"]) type?: CallType;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) cursor?: string;
}
export class CallHistoryDto {
  @ApiProperty() id!: string;
  @ApiProperty() branchId!: string;
  @ApiProperty() tableId!: string;
  @ApiProperty({ enum: ["waiter","hookah"] }) type!: CallType;
  @ApiProperty({ enum: ["queued","no_staff"] }) deliveryState!: CallDeliveryState;
  @ApiProperty() recipientsCount!: number;
  @ApiProperty() ownerAlerted!: boolean;
  @ApiProperty() createdAt!: string;
}
export class CallHistoryResponseDto {
  @ApiProperty({ type: [CallHistoryDto] }) data!: CallHistoryDto[];
  @ApiProperty() meta!: { hasMore: boolean; nextCursor: string | null };
}
export class AlertDto {
  @ApiProperty() id!: string;
  @ApiProperty() branchId!: string;
  @ApiProperty() callId!: string;
  @ApiProperty() type!: "no_staff";
  @ApiProperty() createdAt!: string;
}
export class AlertsResponseDto {
  @ApiProperty({ type: [AlertDto] }) data!: AlertDto[];
  @ApiProperty() meta!: { hasMore: boolean; nextCursor: string | null };
}
