import { Type } from "class-transformer";
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsDefined, IsIn, IsInt,
  IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { EntitlementSnapshot, SubscriptionPeriod } from "../../../database/database.types";
import type { EffectiveSubscriptionStatus } from "../domain/subscription-policy";

export class PlanFeaturesDto {
  @ApiProperty() @IsBoolean() menu!: boolean;
  @ApiProperty() @IsBoolean() waiter_calls!: boolean;
  @ApiProperty() @IsBoolean() hookah_calls!: boolean;
  @ApiProperty() @IsBoolean() analytics!: boolean;
}
export class PatchPlanFeaturesDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() menu?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() waiter_calls?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hookah_calls?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() analytics?: boolean;
}

export class CreatePlanDto {
  @ApiProperty({ maxLength: 120 }) @IsString() @MinLength(1) @MaxLength(120) @Matches(/\S/u) name!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(100000) maxBranches!: number;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(100000) maxTables!: number;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) @Max(100000) maxEmployees!: number;
  @ApiProperty({ type: PlanFeaturesDto }) @IsDefined() @ValidateNested() @Type(() => PlanFeaturesDto) features!: PlanFeaturesDto;
}

export class PatchPlanDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) @Matches(/\S/u) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100000) maxBranches?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100000) maxTables?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100000) maxEmployees?: number;
  @ApiPropertyOptional({ type: PatchPlanFeaturesDto }) @IsOptional() @ValidateNested() @Type(() => PatchPlanFeaturesDto) features?: PatchPlanFeaturesDto;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ListPlansQueryDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) cursor?: string;
}

export class PlanDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() maxBranches!: number;
  @ApiProperty() maxTables!: number;
  @ApiProperty() maxEmployees!: number;
  @ApiProperty({ type: PlanFeaturesDto }) features!: PlanFeaturesDto;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}
export class PlanResponseDto { @ApiProperty({ type: PlanDto }) data!: PlanDto; }
export class PageMetaDto {
  @ApiProperty({ nullable: true }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}
export class PlanListResponseDto {
  @ApiProperty({ type: [PlanDto] }) data!: PlanDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}

export class CreatePendingSubscriptionDto {
  @ApiProperty({ format: "uuid" }) @IsUUID("4") planId!: string;
  @ApiProperty({ enum: ["monthly", "yearly"] }) @IsIn(["monthly", "yearly"]) period!: SubscriptionPeriod;
}
export class ActivateSubscriptionDto {
  @ApiPropertyOptional({ format: "date-time", description: "UTC ISO string ending Z; defaults to current server time" })
  @IsOptional() @IsDateString({ strict: true }) @Matches(/Z$/) startsAt?: string;
  @ApiProperty({ minimum: 0, maximum: 365, description: "Explicit grace days; zero disables grace" })
  @IsInt() @Min(0) @Max(365) graceDays!: number;
}
export class RenewSubscriptionDto {
  @ApiPropertyOptional({ enum: ["monthly", "yearly"] })
  @IsOptional() @IsIn(["monthly", "yearly"]) period?: SubscriptionPeriod;
  @ApiProperty({ minimum: 0, maximum: 365 })
  @IsInt() @Min(0) @Max(365) graceDays!: number;
}

export class SubscriptionDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) restaurantId!: string;
  @ApiProperty({ format: "uuid" }) planId!: string;
  @ApiProperty({ enum: ["monthly", "yearly"] }) period!: SubscriptionPeriod;
  @ApiProperty({ enum: ["pending", "scheduled", "active", "grace", "expired", "cancelled"] })
  effectiveStatus!: EffectiveSubscriptionStatus;
  @ApiProperty() canOperate!: boolean;
  @ApiProperty({ nullable: true, format: "date-time" }) startsAt!: string | null;
  @ApiProperty({ nullable: true, format: "date-time" }) endsAt!: string | null;
  @ApiProperty({ nullable: true, format: "date-time" }) graceEndsAt!: string | null;
  @ApiProperty() graceDays!: number;
  @ApiProperty({ nullable: true, type: Object }) entitlements!: EntitlementSnapshot | null;
}
export class SubscriptionResponseDto { @ApiProperty({ type: SubscriptionDto }) data!: SubscriptionDto; }

export class ContactDto {
  @ApiProperty({ enum: ["whatsapp", "phone", "email"] }) type!: "whatsapp" | "phone" | "email";
  @ApiProperty() label!: string;
  @ApiProperty() value!: string;
  @ApiProperty() enabled!: boolean;
}
export class ContactInputDto {
  @ApiProperty({ enum: ["whatsapp", "phone", "email"] })
  @IsIn(["whatsapp", "phone", "email"]) type!: "whatsapp" | "phone" | "email";
  @ApiProperty() @IsString() @MaxLength(120) @Matches(/\S/u) label!: string;
  @ApiProperty({ maxLength: 256 }) @IsString() @MaxLength(256) @Matches(/\S/u) value!: string;
  @ApiProperty() @IsBoolean() enabled!: boolean;
}
export class ReplaceContactsDto {
  @ApiProperty({ type: [ContactInputDto] }) @IsArray() @ArrayMaxSize(10)
  @ValidateNested({ each: true }) @Type(() => ContactInputDto) contacts!: ContactInputDto[];
}
export class ContactsResponseDto { @ApiProperty({ type: [ContactDto] }) data!: ContactDto[]; }
export class OwnerSubscriptionDataDto {
  @ApiProperty({ type: SubscriptionDto, nullable: true }) subscription!: SubscriptionDto | null;
  @ApiProperty({ type: [ContactDto] }) renewalContacts!: ContactDto[];
  @ApiProperty() canOperate!: boolean;
}
export class OwnerSubscriptionResponseDto {
  @ApiProperty({ type: OwnerSubscriptionDataDto }) data!: OwnerSubscriptionDataDto;
}
