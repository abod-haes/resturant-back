import { type INestApplication, ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
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
    app.enableCors({ origin: [...config.corsOrigins], credentials: true });
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Restaurant Platform API")
    .setVersion("0.2.0")
    .addBearerAuth()
    .build();
  SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, swaggerConfig));
}
