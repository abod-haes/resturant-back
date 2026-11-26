import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, IsUrl, IsUUID, Matches, MaxLength } from "class-validator";

export type RestaurantFont = "cairo" | "system";
export class BrandingPatchDto {
  @ApiPropertyOptional({ type: String, enum: ["cairo", "system"], nullable: true })
  @IsOptional() @IsIn(["cairo", "system"])
  fontFamily?: RestaurantFont | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2048 })
  @IsOptional() @IsString() @MaxLength(2048)
  @IsUrl({ protocols: ["https"], require_protocol: true, disallow_auth: true })
  logoUrl?: string | null;

  @ApiPropertyOptional({ format: "uuid", description: "Ready image asset owned by the restaurant; mutually exclusive with logoUrl" })
  @IsOptional() @IsUUID("4")
  logoMediaId?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: "#174C35" })
  @IsOptional() @IsString() @Matches(/^#[0-9a-fA-F]{6}$/)
  primaryColor?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: "#D4A853" })
  @IsOptional() @IsString() @Matches(/^#[0-9a-fA-F]{6}$/)
  secondaryColor?: string | null;
}

export class BrandingDto {
  @ApiProperty({ type: String, enum: ["cairo", "system"], nullable: true }) fontFamily!: RestaurantFont | null;
  @ApiProperty({ type: String, nullable: true }) logoUrl!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) logoPath?: string | null;
  @ApiProperty({ type: String, nullable: true }) primaryColor!: string | null;
  @ApiProperty({ type: String, nullable: true }) secondaryColor!: string | null;
}
