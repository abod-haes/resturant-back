import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDefined, IsInt, IsString, Matches, MaxLength, ValidateIf, ValidateNested } from "class-validator";
export class WebPushKeysDto {
 @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{87}$/) p256dh!: string;
 @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{22}$/) auth!: string;
}
export class RegisterWebPushDto {
 @ApiProperty() @IsString() @MaxLength(2048) endpoint!: string;
 @ApiProperty({type:Number,nullable:true}) @ValidateIf(o=>o.expirationTime!==null) @IsDefined() @IsInt() expirationTime!: number|null;
 @ApiProperty({type:WebPushKeysDto}) @IsDefined() @ValidateNested() @Type(()=>WebPushKeysDto) keys!: WebPushKeysDto;
}
export class WebPushDeviceDto {
 @ApiProperty({format:"uuid"}) id!: string;
 @ApiProperty() isActive!: boolean;
}
export class WebPushDeviceResponseDto {
 @ApiProperty({type:WebPushDeviceDto}) data!: WebPushDeviceDto;
}
