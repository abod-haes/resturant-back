import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength,
  Min, MinLength,
} from "class-validator";

export class CreatePlatformAdminDto {
  @ApiProperty({ example: "Platform Administrator", maxLength: 200 })
  @IsString() @MaxLength(200) @Matches(/\S/u) name!: string;

  @ApiProperty({ example: "platform_admin_1", minLength: 3, maxLength: 64 })
  @IsString() @Matches(/^[A-Za-z0-9._-]{3,64}$/) username!: string;

  @ApiProperty({ writeOnly: true, minLength: 12, maxLength: 128 })
  @IsString() @MinLength(12) @MaxLength(128) initialPassword!: string;
}

export class PlatformAdminListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;

  @ApiPropertyOptional({ description: "Opaque keyset pagination cursor" })
  @IsOptional() @IsString() @MaxLength(500) cursor?: string;

  @ApiPropertyOptional({ description: "Literal case-insensitive name or username search" })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) search?: string;
}

export class UpdatePlatformAdminDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional() @IsString() @MaxLength(200) @Matches(/\S/u) name?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ResetPlatformAdminPasswordDto {
  @ApiProperty({ writeOnly: true, minLength: 12, maxLength: 128 })
  @IsString() @MinLength(12) @MaxLength(128) initialPassword!: string;
}

export class PlatformAdminDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() username!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ["PLATFORM_ADMIN"] }) role!: "PLATFORM_ADMIN";
  @ApiProperty() isActive!: boolean;
  @ApiProperty() mustChangePassword!: boolean;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}

export class PlatformAdminResponseDto {
  @ApiProperty({ type: PlatformAdminDto }) data!: PlatformAdminDto;
}

export class PlatformAdminPageMetaDto {
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}

export class PlatformAdminListResponseDto {
  @ApiProperty({ type: [PlatformAdminDto] }) data!: PlatformAdminDto[];
  @ApiProperty({ type: PlatformAdminPageMetaDto }) meta!: PlatformAdminPageMetaDto;
}

export class PlatformAdminResetResponseDto {
  @ApiProperty({ type: Object }) data!: { reset: boolean };
}
