import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches } from "class-validator";

export class SessionCredentialDto {
  @ApiProperty({ description: "Opaque 43-character visit token, not the QR token" })
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) sessionToken!: string;
}
export class VisitSessionDto {
  @ApiProperty() sessionToken!: string;
  @ApiProperty({ format: "date-time" }) expiresAt!: string;
  @ApiProperty() firstCallNeedsConfirmation!: boolean;
  @ApiProperty({ enum: ["waiter", "hookah"], isArray: true }) availableCallTypes!: ("waiter" | "hookah")[];
}
export class VisitSessionEnvelopeDto { @ApiProperty({ type: VisitSessionDto }) data!: VisitSessionDto; }
export class VisitStateDto {
  @ApiProperty({ format: "date-time" }) expiresAt!: string;
  @ApiProperty() firstCallNeedsConfirmation!: boolean;
  @ApiProperty({ enum: ["waiter", "hookah"], isArray: true }) availableCallTypes!: ("waiter" | "hookah")[];
}
export class VisitStateEnvelopeDto { @ApiProperty({ type: VisitStateDto }) data!: VisitStateDto; }
