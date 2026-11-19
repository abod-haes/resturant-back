import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";

export class AdminAuditQueryDto {
  @ApiPropertyOptional({ format: "uuid" }) @IsOptional() @IsUUID("4") restaurantId?: string;
  @ApiPropertyOptional({ format: "uuid" }) @IsOptional() @IsUUID("4") actorId?: string;
  @ApiPropertyOptional({ description: "Exact audit action" })
  @IsOptional() @Matches(/^[a-z][a-z0-9_.-]{0,99}$/) action?: string;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) cursor?: string;
}
export class AuditEntryDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ nullable: true, format: "uuid" }) actorId!: string | null;
  @ApiProperty({ nullable: true, format: "uuid" }) restaurantId!: string | null;
  @ApiProperty() action!: string;
  @ApiProperty() entityType!: string;
  @ApiProperty({ nullable: true, format: "uuid" }) entityId!: string | null;
  @ApiProperty({ nullable: true }) requestId!: string | null;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}
export class AdminAuditResponseDto {
  @ApiProperty({ type: [AuditEntryDto] }) data!: AuditEntryDto[];
  @ApiProperty() meta!: { hasMore: boolean; nextCursor: string | null };
}
