import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean, IsDefined, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength,
  ValidateNested,
} from "class-validator";

export class CreateOwnerDto {
  @ApiProperty({ example: "Restaurant Owner" })
  @IsString()
  @MaxLength(200)
  @Matches(/\S/u)
  name!: string;

  @ApiProperty({ example: "owner_1", minLength: 3, maxLength: 64 })
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{3,64}$/)
  username!: string;

  @ApiProperty({ writeOnly: true, minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  initialPassword!: string;
}

export class InitialBranchDto {
  @ApiProperty({ example: "Main Branch" })
  @IsString()
  @MaxLength(200)
  @Matches(/\S/u)
  name!: string;
}

export class CreateRestaurantDto {
  @ApiProperty({ example: "Basil Restaurant" })
  @IsString()
  @MaxLength(200)
  @Matches(/\S/u)
  name!: string;

  @ApiProperty({ type: CreateOwnerDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => CreateOwnerDto)
  owner!: CreateOwnerDto;

  @ApiProperty({ type: InitialBranchDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => InitialBranchDto)
  initialBranch!: InitialBranchDto;
}

export class UpdateRestaurantDto {
  @ApiPropertyOptional({ example: "New Restaurant Name" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/\S/u)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class RestaurantListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({ description: "Opaque cursor returned by the previous page" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;

  @ApiPropertyOptional({ description: "Literal, case-insensitive restaurant-name substring" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  search?: string;
}

export class OnboardingDataDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ format: "uuid" }) ownerId!: string;
  @ApiProperty({ format: "uuid" }) branchId!: string;
}

export class OnboardingResponseDto {
  @ApiProperty({ type: OnboardingDataDto }) data!: OnboardingDataDto;
}

export class RestaurantOwnerDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() username!: string;
}

export class RestaurantSummaryDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty() branchCount!: number;
  @ApiProperty({ type: String, nullable: true }) subscriptionStatus!: string | null;
  @ApiProperty({ type: String, nullable: true }) planName!: string | null;
  @ApiProperty({ type: RestaurantOwnerDto, nullable: true }) owner!: RestaurantOwnerDto | null;
}

export class RestaurantListMetaDto {
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}

export class RestaurantListResponseDto {
  @ApiProperty({ type: [RestaurantSummaryDto] }) data!: RestaurantSummaryDto[];
  @ApiProperty({ type: RestaurantListMetaDto }) meta!: RestaurantListMetaDto;
}

export class InitialBranchResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() isActive!: boolean;
}

export class RestaurantDetailsDto extends RestaurantSummaryDto {
  @ApiProperty({ type: InitialBranchResponseDto, nullable: true })
  initialBranch!: InitialBranchResponseDto | null;
}

export class RestaurantDetailsResponseDto {
  @ApiProperty({ type: RestaurantDetailsDto }) data!: RestaurantDetailsDto;
}

/** Server-calculated totals; never infer platform-wide counts from a paginated page. */
export class PlatformOverviewDto {
  @ApiProperty() restaurants!: number;
  @ApiProperty() activeRestaurants!: number;
  @ApiProperty() inactiveRestaurants!: number;
  @ApiProperty() branches!: number;
  @ApiProperty() activeSubscriptions!: number;
  @ApiProperty() expiringSubscriptions!: number;
}
export class PlatformOverviewResponseDto {
  @ApiProperty({ type: PlatformOverviewDto }) data!: PlatformOverviewDto;
}
