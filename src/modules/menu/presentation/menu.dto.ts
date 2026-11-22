import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUrl,
  IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from "class-validator";

export class MenuPageDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) cursor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) @Matches(/\S/u) search?: string;
}
export class OwnerProductListQueryDto extends MenuPageDto {
  @ApiPropertyOptional({ format: "uuid", description: "Filter products by category within the selected branch" })
  @IsOptional() @IsUUID("4") categoryId?: string;
}
export class MenuPageMetaDto {
  @ApiProperty({ nullable: true }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}
export class CreateCategoryDto {
  @ApiProperty() @IsString() @MaxLength(160) @Matches(/\S/u) name!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @ApiPropertyOptional({ minimum: 0 }) @IsOptional() @IsInt() @Min(0) @Max(1000000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class PatchCategoryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) @Matches(/\S/u) name?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @ApiPropertyOptional({ minimum: 0 }) @IsOptional() @IsInt() @Min(0) @Max(1000000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class CategoryDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) branchId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}
export class CategoryResponseDto { @ApiProperty({ type: CategoryDto }) data!: CategoryDto; }
export class CategoryListDto {
  @ApiProperty({ type: [CategoryDto] }) data!: CategoryDto[];
  @ApiProperty({ type: MenuPageMetaDto }) meta!: MenuPageMetaDto;
}
export class ProductImageInputDto {
  @ApiProperty({ example: "https://images.example.test/products/item.webp" })
  @IsString() @MaxLength(2048) @IsUrl({ protocols: ["https"], require_protocol: true, require_tld: true })
  url!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(200) alt?: string | null;
}
export class CreateProductDto {
  @ApiProperty({ format: "uuid" }) @IsUUID("4") categoryId!: string;
  @ApiProperty() @IsString() @MaxLength(200) @Matches(/\S/u) name!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(3000) description?: string | null;
  @ApiProperty({ description: "Integer minor units (e.g. cents) of branch currency" })
  @IsInt() @Min(0) @Max(2147483647) priceMinor!: number;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) oldPriceMinor?: number | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(12)
  @ArrayUnique() @IsString({ each: true }) @MaxLength(32, { each: true })
  @Matches(/\S/u, { each: true }) tags?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isVisible?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isSoldOut?: boolean;
  @ApiPropertyOptional({ minimum: 0 }) @IsOptional() @IsInt() @Min(0) @Max(1000000) sortOrder?: number;
  @ApiPropertyOptional({ type: [ProductImageInputDto], maxItems: 8 })
  @IsOptional() @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true })
  @Type(() => ProductImageInputDto) images?: ProductImageInputDto[];
}
export class PatchProductDto {
  @ApiPropertyOptional({ format: "uuid" }) @IsOptional() @IsUUID("4") categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) @Matches(/\S/u) name?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(3000) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(2147483647) priceMinor?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(1) @Max(2147483647) oldPriceMinor?: number | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(12)
  @ArrayUnique() @IsString({ each: true }) @MaxLength(32, { each: true })
  @Matches(/\S/u, { each: true }) tags?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isVisible?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isSoldOut?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000000) sortOrder?: number;
  @ApiPropertyOptional({ type: [ProductImageInputDto], maxItems: 8 })
  @IsOptional() @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true })
  @Type(() => ProductImageInputDto) images?: ProductImageInputDto[];
}
export class ProductImageDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiPropertyOptional({ format: "uuid", nullable: true }) mediaId?: string | null;
  @ApiProperty() url!: string;
  @ApiProperty({ nullable: true }) alt!: string | null;
  @ApiProperty() sortOrder!: number;
}
export class ProductDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) branchId!: string;
  @ApiProperty({ format: "uuid" }) categoryId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty() priceMinor!: number;
  @ApiProperty({ nullable: true }) oldPriceMinor!: number | null;
  @ApiProperty() currency!: string;
  @ApiProperty({ type: [String] }) tags!: string[];
  @ApiProperty() isVisible!: boolean;
  @ApiProperty() isSoldOut!: boolean;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ type: [ProductImageDto] }) images!: ProductImageDto[];
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}
export class ProductResponseDto { @ApiProperty({ type: ProductDto }) data!: ProductDto; }
export class ProductListDto {
  @ApiProperty({ type: [ProductDto] }) data!: ProductDto[];
  @ApiProperty({ type: MenuPageMetaDto }) meta!: MenuPageMetaDto;
}
export class CopyMenuDto {
  @ApiProperty({ format: "uuid" }) @IsUUID("4") sourceBranchId!: string;
  @ApiPropertyOptional({ default: false, description: "Table templates are not supported in this menu slice" })
  @IsOptional() @IsBoolean() includeTemplate?: boolean;
}
export class CopyMenuResultDto {
  @ApiProperty() categoriesCopied!: number;
  @ApiProperty() productsCopied!: number;
}
export class CopyMenuResponseDto { @ApiProperty({ type: CopyMenuResultDto }) data!: CopyMenuResultDto; }

export class PublicMenuRestaurantDto { @ApiProperty() name!: string; }
export class PublicMenuBranchDto { @ApiProperty() name!: string; @ApiProperty() slug!: string; @ApiProperty({ nullable: true }) currency!: string | null; }
export class PublicMenuDto {
  @ApiProperty({ type: PublicMenuRestaurantDto }) restaurant!: PublicMenuRestaurantDto;
  @ApiProperty({ type: PublicMenuBranchDto }) branch!: PublicMenuBranchDto;
  @ApiProperty({ type: [ProductDto] }) products!: ProductDto[];
  @ApiProperty({ type: [CategoryDto] }) categories!: CategoryDto[];
}
export class PublicMenuResponseDto {
  @ApiProperty({ type: PublicMenuDto }) data!: PublicMenuDto;
  @ApiProperty({ type: MenuPageMetaDto }) meta!: MenuPageMetaDto;
}
