import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsString, Matches } from "class-validator";

export class RegisterPushDeviceDto {
  @ApiProperty({ description: "Expo project push token; stored encrypted, never returned" })
  @IsString() @Matches(/^(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]{10,256}\]$/)
  expoPushToken!: string;
  @ApiProperty({ enum: ["ios", "android"] }) @IsIn(["ios", "android"])
  platform!: "ios" | "android";
}
export class PushDeviceDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: ["ios","android"] }) platform!: "ios" | "android";
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ format: "date-time" }) lastSeenAt!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}
export class PushDeviceResponseDto {
  @ApiProperty({ type: PushDeviceDto }) data!: PushDeviceDto;
}
export class PushDevicesResponseDto {
  @ApiProperty({ type: [PushDeviceDto] }) data!: PushDeviceDto[];
}
export class PushDeviceUnregisterDto {
  @ApiPropertyOptional() data!: { unregistered: true };
}
