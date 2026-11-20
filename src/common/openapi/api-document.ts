import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject, type OperationObject } from "@nestjs/swagger";

/**
 * Runtime Swagger is generated from the actual Nest controllers + DTOs.
 * Unlike the historical hand-maintained draft, this cannot advertise a
 * phantom endpoint or silently miss a newly introduced controller method.
 */
export function buildApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("Restaurant Platform API")
    .setDescription([
      "Executable HTTP API for the restaurant platform. Generated from registered NestJS controllers.",
      "Base path /api/v1. All prices are integer currency minor units; timestamps use ISO 8601 UTC.",
      "JWT Bearer on protected operations. Web refresh uses a same-site HttpOnly cookie and trusted Origin;",
      "mobile refresh uses the JSON refreshToken returned only for client=mobile.",
      "Restaurant/branch scope, subscription entitlements and role checks are enforced by the server.",
      "QR credentials, visit tokens, passwords and Expo device tokens must never be logged or put in analytics.",
      "A queued call or accepted Expo ticket does not guarantee delivery to a person's phone.",
    ].join(" "))
    .setVersion("0.12.0")
    .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" })
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerName, methodName) => controllerName + "_" + methodName,
  });

  // This is the exact error envelope produced by ApiExceptionFilter for *all*
  // HTTP failures. Keep it in one central place rather than duplicating response
  // DTOs across unrelated feature controllers.
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas.ApiErrorEnvelope = {
    type: "object",
    required: ["error", "requestId"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: { type: "string", example: "VALIDATION_ERROR" },
          message: { type: "string", example: "Request validation failed" },
          details: { nullable: true, description: "Optional safe validation details; never credentials" },
        },
      },
      requestId: { type: "string", description: "Trace ID for support and diagnostics", format: "uuid" },
    },
  };

  const methods = ["get", "post", "put", "patch", "delete"] as const;
  for (const pathItem of Object.values(document.paths)) {
    if (!pathItem) continue;
    for (const method of methods) {
      const operation: OperationObject | undefined = pathItem[method];
      if (!operation) continue;
      operation.responses ??= {};
      operation.responses.default ??= {
        description: "Non-2xx error: status and code depend on validation, authentication, tenant scope, subscription and rate limits.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
          },
        },
      };
    }
  }
  return document;
}
