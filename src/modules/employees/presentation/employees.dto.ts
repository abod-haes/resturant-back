import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from "class-validator";
import type { Department } from "../../../database/database.types";

export class CreateEmployeeDto {
  @ApiProperty({ format: "uuid" }) @IsUUID("4") branchId!: string;
  @ApiProperty({ enum: ["waiter", "hookah"] }) @IsIn(["waiter", "hookah"]) department!: Department;
  @ApiProperty() @Matches(/^[A-Za-z0-9._-]{3,64}$/) username!: string;
  @ApiProperty() @IsString() @Matches(/\S/u) @MaxLength(200) name!: string;
  @ApiProperty({ writeOnly: true, minLength: 12 }) @IsString() @MinLength(12) @MaxLength(128) initialPassword!: string;
}
export class PatchEmployeeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/\S/u) @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ enum: ["waiter", "hookah"] }) @IsOptional() @IsIn(["waiter", "hookah"]) department?: Department;
}
export class ResetEmployeePasswordDto {
  @ApiProperty({ writeOnly: true }) @IsString() @MinLength(12) @MaxLength(128) initialPassword!: string;
}
export class ListEmployeesQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID("4") branchId?: string;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number)
  @IsInt() @Min(1) @Max(100) limit = 20;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) cursor?: string;
}
export class EmployeeDto {
  @ApiProperty() id!: string;
  @ApiProperty() username!: string;
  @ApiProperty() name!: string;
  @ApiProperty() branchId!: string;
  @ApiProperty({ enum: ["waiter", "hookah"] }) department!: Department;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() mustChangePassword!: boolean;
  @ApiProperty() createdAt!: string;
}
export class EmployeeResponseDto { @ApiProperty({ type: EmployeeDto }) data!: EmployeeDto; }
export class EmployeeListResponseDto {
  @ApiProperty({ type: [EmployeeDto] }) data!: EmployeeDto[];
  @ApiProperty() meta!: { nextCursor: string | null; hasMore: boolean };
}
export class ShiftDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() branchId!: string;
  @ApiProperty({ enum: ["waiter", "hookah"] }) department!: Department;
  @ApiProperty() startedAt!: string;
  @ApiProperty() autoEndAt!: string;
  @ApiProperty({ nullable: true }) endedAt!: string | null;
}
export class ShiftResponseDto { @ApiProperty({ type: ShiftDto, nullable: true }) data!: ShiftDto | null; }
export class ShiftEndResponseDto { @ApiProperty({ type: ShiftDto }) data!: ShiftDto; }
