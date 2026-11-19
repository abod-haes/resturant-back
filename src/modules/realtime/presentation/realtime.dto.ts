import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

export class StreamQueryDto {
  @ApiPropertyOptional({ minimum: 0, description: "Restaurant-scoped event sequence to resume after" })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER)
  after?: number;
}
