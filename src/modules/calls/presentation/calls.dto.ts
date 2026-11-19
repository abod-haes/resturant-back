import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";
import type { CallDeliveryState, CallKind, CallRoutingMode } from "../../../database/database.types";

export class CreateCallDto {
  @ApiProperty({ description: "Opaque 43-character session bearer token" })
  @IsString() sessionToken!: string;
  @ApiProperty({ enum: ["waiter", "hookah"] }) @IsIn(["waiter", "hookah"]) type!: CallKind;
  @ApiProperty({ format: "uuid" }) @IsUUID("4") idempotencyKey!: string;
  @ApiPropertyOptional({ description: "Must be true for the first accepted call in a session" })
  @IsOptional() @IsBoolean() firstCallConfirmed?: boolean;
}
export class CallDto {
  @ApiProperty() id!: string;
  @ApiProperty() tableId!: string;
  @ApiProperty({ enum: ["waiter", "hookah"] }) type!: CallKind;
  @ApiProperty({ enum: ["queued", "no_staff"] }) deliveryState!: CallDeliveryState;
  @ApiProperty() ownerAlerted!: boolean;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}
export class CallEnvelopeDto { @ApiProperty({ type: CallDto }) data!: CallDto; }
export class CallPageDto {
  @ApiProperty({ type: [CallDto] }) data!: CallDto[];
  @ApiProperty() meta!: { nextCursor: string | null; hasMore: boolean };
}
export class ListCallsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
}
export class RestaurantRoutingPatchDto {
  @ApiProperty({ enum: ["all", "department"] }) @IsIn(["all","department"]) routingMode!: CallRoutingMode;
}
export class BranchRoutingPatchDto {
  @ApiPropertyOptional({ enum: ["all", "department"], nullable: true })
  @IsOptional() @IsIn(["all","department",null]) routingMode?: CallRoutingMode | null;
  @ApiPropertyOptional({ minimum: 60, maximum: 1440 })
  @IsOptional() @IsInt() @Min(60) @Max(1440) shiftMaxMinutes?: number;
}
export class BranchRoutingDto {
  @ApiProperty({ enum: ["all", "department"], nullable: true }) routingMode!: CallRoutingMode | null;
  @ApiProperty({ enum: ["all", "department"] }) effectiveRoutingMode!: CallRoutingMode;
  @ApiProperty() shiftMaxMinutes!: number;
}
export class RoutingDto { @ApiProperty({ enum: ["all","department"] }) routingMode!: CallRoutingMode; }
export class RoutingEnvelopeDto { @ApiProperty({ type: RoutingDto }) data!: RoutingDto; }
export class BranchRoutingEnvelopeDto { @ApiProperty({ type: BranchRoutingDto }) data!: BranchRoutingDto; }
export class OwnerAlertDto {
  @ApiProperty() id!: string;
  @ApiProperty() callId!: string;
  @ApiProperty() branchId!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty({ format: "date-time", nullable: true }) readAt!: string | null;
}
export class OwnerAlertsEnvelopeDto { @ApiProperty({ type: [OwnerAlertDto] }) data!: OwnerAlertDto[]; }
