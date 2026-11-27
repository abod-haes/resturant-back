import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { BrandingDto } from "../../../common/tenancy/branding.dto";
import type { PlatformRole, Department } from "../../../database/database.types";

export class LoginDto {
  @ApiProperty({ example: "owner_1", minLength: 3, maxLength: 64 })
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{3,64}$/)
  username!: string;

  @ApiProperty({ writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({ enum: ["web", "mobile"], default: "web" })
  @IsOptional()
  @IsIn(["web", "mobile"])
  client?: "web" | "mobile";
}

export class RefreshDto {
  @ApiPropertyOptional({ description: "Mobile clients only; browser clients use HttpOnly cookie" })
  @IsOptional()
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  refreshToken?: string;
}

export class ChangePasswordDto {
  @ApiProperty({ writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ writeOnly: true, minLength: 12 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}

export class UserDto {
  @ApiPropertyOptional() name?: string;
  @ApiPropertyOptional() username?: string;
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: ["PRIMARY_ADMIN","PLATFORM_ADMIN","RESTAURANT_OWNER","EMPLOYEE"] }) role!: PlatformRole;
  @ApiProperty({ format: "uuid", nullable: true }) restaurantId!: string | null;
  @ApiProperty({ format: "uuid", nullable: true }) branchId!: string | null;
  @ApiProperty({ enum: ["waiter", "hookah"], nullable: true }) department!: Department | null;
  @ApiProperty() mustChangePassword!: boolean;
}

export class LoginDataDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ type: String, format: "date-time" }) expiresAt!: string;
  @ApiProperty({ type: UserDto }) user!: UserDto;
  @ApiPropertyOptional({ description: "Only returned for mobile clients", writeOnly: true })
  refreshToken?: string;
}

export class LoginResponseDto {
  @ApiProperty({ type: LoginDataDto }) data!: LoginDataDto;
}

export class MeResponseDto {
  @ApiProperty({ type: UserDto }) data!: UserDto;
}

export class ChangedResponseDto {
  @ApiProperty({ type: Object }) data!: { changed: boolean };
}

export class AuthenticatedRestaurantIdentityDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) subdomain!: string | null;
  @ApiProperty({ type: BrandingDto }) branding!: BrandingDto;
}

export class AuthenticatedRestaurantIdentityResponseDto {
  @ApiProperty({ type: AuthenticatedRestaurantIdentityDto }) data!: AuthenticatedRestaurantIdentityDto;
}
