import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDefined, IsInt, IsString, Matches, MaxLength, ValidateIf, ValidateNested } from "class-validator";
export class WebPushKeysDto {
 @ApiProperty({minLength:87,maxLength:87,pattern:"^[A-Za-z0-9_-]{87}$"}) @IsString() @Matches(/^[A-Za-z0-9_-]{87}$/) p256dh!: string;
 @ApiProperty({minLength:22,maxLength:22,pattern:"^[A-Za-z0-9_-]{22}$"}) @IsString() @Matches(/^[A-Za-z0-9_-]{22}$/) auth!: string;
}
export class RegisterWebPushDto {
 @ApiProperty({format:"uri",maxLength:2048,description:"HTTPS endpoint from a supported browser push provider"}) @IsString() @MaxLength(2048) endpoint!: string;
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

export class WebPushConfigDto {
 @ApiProperty() enabled!: boolean;
 @ApiProperty({type:String,nullable:true}) publicKey!: string|null;
}
export class WebPushConfigResponseDto {
 @ApiProperty({type:WebPushConfigDto}) data!: WebPushConfigDto;
}

export class WebPushUnregisteredDto {
 @ApiProperty() unregistered!: boolean;
}
export class WebPushUnregisteredResponseDto {
 @ApiProperty({type:WebPushUnregisteredDto}) data!: WebPushUnregisteredDto;
}
