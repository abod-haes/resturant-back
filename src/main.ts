import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureHttpApp } from "./bootstrap";
import { RUNTIME_CONFIG, type RuntimeConfig } from "./common/config/runtime-config";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureHttpApp(app);
  app.enableShutdownHooks();
  const config = app.get<RuntimeConfig>(RUNTIME_CONFIG);
  await app.listen(config.port, "0.0.0.0");
}

void bootstrap().catch((error: unknown) => {
  // Configuration errors must fail startup without printing secrets.
  console.error(error instanceof Error ? error.message : "Application bootstrap failed");
  process.exitCode = 1;
});
