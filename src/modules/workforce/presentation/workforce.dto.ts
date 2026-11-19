import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength,
} from "class-validator";

export class CreateEmployeeDto {
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9._-]{3,64}$/) username!: string;
  @ApiProperty() @IsString() @MaxLength(200) @Matches(/\S/u) displayName!: string;
  @ApiProperty({ minLength: 12 }) @IsString() @MinLength(12) @MaxLength(128) initialPassword!: string;
  @ApiProperty({ enum: ["waiter", "hookah"] }) @IsIn(["waiter","hookah"]) department!: "waiter" | "hookah";
}
export class EmployeeDto {
  @ApiProperty() id!: string;
  @ApiProperty() branchId!: string;
  @ApiProperty() username!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: ["waiter", "hookah"] }) department!: "waiter" | "hookah";
  @ApiProperty() isActive!: boolean;
}
export class EmployeeEnvelopeDto { @ApiProperty({ type: EmployeeDto }) data!: EmployeeDto; }
export class EmployeePageQueryDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) cursor?: string;
}
export class EmployeeListEnvelopeDto {
  @ApiProperty({ type: [EmployeeDto] }) data!: EmployeeDto[];
  @ApiProperty() meta!: { nextCursor: string | null; hasMore: boolean };
}

export class ShiftDto {
  @ApiProperty() id!: string;
  @ApiProperty() employeeId!: string;
  @ApiProperty() branchId!: string;
  @ApiProperty({ format: "date-time" }) startedAt!: string;
  @ApiProperty({ format: "date-time" }) plannedEndsAt!: string;
  @ApiProperty({ format: "date-time", nullable: true }) endedAt!: string | null;
  @ApiProperty() isOnShift!: boolean;
}
export class ShiftEnvelopeDto { @ApiProperty({ type: ShiftDto, nullable: true }) data!: ShiftDto | null; }
export class ShiftListQueryDto {
  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
