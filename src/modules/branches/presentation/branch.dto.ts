import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";

export class BranchCreateDto {
  @ApiProperty() @IsString() @MaxLength(200) @Matches(/\S/u) name!: string;
  @ApiPropertyOptional({ example: "USD", description: "Optional until price publication" })
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency?: string;
}
export class BranchPatchDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) @Matches(/\S/u) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class BranchPageDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) cursor?: string;
}
export class BranchDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ nullable: true }) currency!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}
export class BranchResponseDto { @ApiProperty({ type: BranchDto }) data!: BranchDto; }
export class BranchPageMetaDto {
  @ApiProperty({ nullable: true }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}
export class BranchListResponseDto {
  @ApiProperty({ type: [BranchDto] }) data!: BranchDto[];
  @ApiProperty({ type: BranchPageMetaDto }) meta!: BranchPageMetaDto;
}
