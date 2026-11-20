import { type INestApplication, ValidationPipe } from "@nestjs/common";
import { SwaggerModule } from "@nestjs/swagger";
import { buildApiDocument } from "./common/openapi/api-document";
import { ApiExceptionFilter } from "./common/http/api-exception.filter";
import { requestIdMiddleware } from "./common/http/request-id.middleware";
import { RUNTIME_CONFIG, type RuntimeConfig } from "./common/config/runtime-config";

export function configureHttpApp(app: INestApplication): void {
  const config = app.get<RuntimeConfig>(RUNTIME_CONFIG);
  app.setGlobalPrefix("api/v1");
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  if (config.corsOrigins.length > 0) {
    // Reflect the request Origin for wildcard mode: browsers reject "*" with credentials.
    // Authentication and refresh-cookie origin checks remain independently enforced.
    app.enableCors({ origin: config.corsOrigins.includes("*") ? true : [...config.corsOrigins], credentials: true });
  }

  SwaggerModule.setup("api/docs", app, buildApiDocument(app));
}
