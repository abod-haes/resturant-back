import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsInt, IsOptional,
  IsString, IsUUID, Matches, Max, MaxLength, Min,
} from "class-validator";

export class TableListQueryDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) cursor?: string;
}
export class TablePageMetaDto {
  @ApiProperty({ nullable: true }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}
export class CreateFloorDto {
  @ApiProperty() @IsString() @MaxLength(120) @Matches(/\S/u) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000000) sortOrder?: number;
}
export class PatchFloorDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) @Matches(/\S/u) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class FloorDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) branchId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() isActive!: boolean;
}
export class FloorResponseDto { @ApiProperty({ type: FloorDto }) data!: FloorDto; }
export class FloorListResponseDto {
  @ApiProperty({ type: [FloorDto] }) data!: FloorDto[];
  @ApiProperty({ type: TablePageMetaDto }) meta!: TablePageMetaDto;
}
export class CreateAreaDto {
  @ApiProperty({ format: "uuid" }) @IsUUID("4") floorId!: string;
  @ApiProperty() @IsString() @MaxLength(120) @Matches(/\S/u) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000000) sortOrder?: number;
}
export class PatchAreaDto {
  @ApiPropertyOptional({ format: "uuid" }) @IsOptional() @IsUUID("4") floorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) @Matches(/\S/u) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class AreaDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) branchId!: string;
  @ApiProperty({ format: "uuid" }) floorId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() isActive!: boolean;
}
export class AreaResponseDto { @ApiProperty({ type: AreaDto }) data!: AreaDto; }
export class AreaListResponseDto {
  @ApiProperty({ type: [AreaDto] }) data!: AreaDto[];
  @ApiProperty({ type: TablePageMetaDto }) meta!: TablePageMetaDto;
}
export class CreateTableDto {
  @ApiProperty({ format: "uuid" }) @IsUUID("4") areaId!: string;
  @ApiProperty() @IsString() @MaxLength(100) @Matches(/\S/u) label!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000000) sortOrder?: number;
}
export class CreateTablesBulkDto {
  @ApiProperty({ format: "uuid" }) @IsUUID("4") areaId!: string;
  @ApiProperty({ type: [String], maxItems: 50 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ArrayUnique()
  @IsString({ each: true }) @MaxLength(100, { each: true }) @Matches(/\S/u, { each: true })
  labels!: string[];
}
export class PatchTableDto {
  @ApiPropertyOptional({ format: "uuid" }) @IsOptional() @IsUUID("4") areaId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) @Matches(/\S/u) label?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() qrEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() callsEnabled?: boolean;
}
export class RestaurantTableDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) branchId!: string;
  @ApiProperty({ format: "uuid" }) areaId!: string;
  @ApiProperty() label!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() qrEnabled!: boolean;
  @ApiProperty() callsEnabled!: boolean;
  @ApiProperty() qrVersion!: number;
}
export class RestaurantTableResponseDto {
  @ApiProperty({ type: RestaurantTableDto }) data!: RestaurantTableDto;
}
export class RestaurantTableListResponseDto {
  @ApiProperty({ type: [RestaurantTableDto] }) data!: RestaurantTableDto[];
  @ApiProperty({ type: TablePageMetaDto }) meta!: TablePageMetaDto;
}
export class RestaurantTableBulkResponseDto {
  @ApiProperty({ type: [RestaurantTableDto] }) data!: RestaurantTableDto[];
}
export class ArchiveResponseDto {
  @ApiProperty() archived!: boolean;
}
export class ArchiveEnvelopeDto { @ApiProperty({ type: ArchiveResponseDto }) data!: ArchiveResponseDto; }
export class QrCodeDataDto {
  @ApiProperty() url!: string;
  @ApiProperty() version!: number;
  @ApiProperty() enabled!: boolean;
}
export class QrCodeResponseDto { @ApiProperty({ type: QrCodeDataDto }) data!: QrCodeDataDto; }
export class PublicTableContextDto {
  @ApiProperty() restaurant!: { name: string };
  @ApiProperty() branch!: { name: string; slug: string };
  @ApiProperty() table!: { id: string; label: string };
  @ApiProperty() menuPath!: string;
  @ApiProperty() callsAvailable!: boolean;
}
export class PublicTableContextResponseDto { @ApiProperty({ type: PublicTableContextDto }) data!: PublicTableContextDto; }

export class QrPrintQueryDto {
  @ApiPropertyOptional({ description: "Optional comma-separated table UUIDs; otherwise up to 100 tables in branch" })
  @IsOptional() @IsString() @MaxLength(3700) tableIds?: string;
}
