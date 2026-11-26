import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from "class-validator";

export class MediaListQueryDto {
  @ApiPropertyOptional({ enum: ["image", "document"] })
  @IsOptional() @IsIn(["image","document"]) kind?: "image" | "document";
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) cursor?: string;
}
export class MediaDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) branchId!: string;
  @ApiProperty({ enum: ["image","document"] }) kind!: "image" | "document";
  @ApiProperty({ nullable: true }) url!: string | null;
  @ApiProperty({ type: String, nullable: true, description: "Relative public image path; null for private documents" }) path!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty() contentType!: string;
  @ApiProperty() byteSize!: number;
  @ApiProperty({ nullable: true }) width!: number | null;
  @ApiProperty({ nullable: true }) height!: number | null;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}
export class MediaResponseDto { @ApiProperty({ type: MediaDto }) data!: MediaDto; }
export class MediaListResponseDto {
  @ApiProperty({ type: [MediaDto] }) data!: MediaDto[];
  @ApiProperty() meta!: { hasMore: boolean; nextCursor: string | null };
}
export class DocumentAccessDto {
  @ApiProperty({ format: "uri" }) url!: string;
  @ApiProperty({ minimum: 1 }) expiresInSeconds!: number;
}
export class DocumentAccessResponseDto { @ApiProperty({ type: DocumentAccessDto }) data!: DocumentAccessDto; }
export class GalleryImageInputDto {
  @ApiProperty({ format: "uuid" }) @IsUUID("4") mediaId!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(200) alt?: string | null;
}
export class ReplaceGalleryDto {
  @ApiProperty({ type: [GalleryImageInputDto], maxItems: 8 })
  @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true })
  @Type(() => GalleryImageInputDto) images!: GalleryImageInputDto[];
}
export class GalleryImageDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid", nullable: true }) mediaId!: string | null;
  @ApiProperty() url!: string;
  @ApiProperty({ nullable: true }) alt!: string | null;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() isPrimary!: boolean;
}
export class GalleryResponseDto { @ApiProperty({ type: [GalleryImageDto] }) data!: GalleryImageDto[]; }
