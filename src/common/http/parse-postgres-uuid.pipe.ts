import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";

/**
 * PostgreSQL UUID accepts canonical 8-4-4-4-12 hexadecimal identifiers regardless
 * of their RFC 4122 version/variant bits. Older seeded rows use such IDs.
 * Never weaken tenant authorization: this pipe checks syntax only.
 */
export const POSTGRES_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ParsePostgresUuidPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (typeof value !== "string" || !POSTGRES_UUID_PATTERN.test(value)) {
      throw new BadRequestException("Validation failed (PostgreSQL UUID expected)");
    }
    return value;
  }
}
