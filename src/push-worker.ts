import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { RUNTIME_CONFIG, type RuntimeConfig } from "./common/config/runtime-config";
import { PushDispatcherService } from "./modules/push/application/push-dispatcher.service";

const LOOP_MS = 1000;

/**
 * Run as a separate Dokploy worker process: npm run push:worker.
 * API replicas never send push directly, and the DB uses SKIP LOCKED per delivery.
 */
async function main(): Promise<void> {
  const logger = new Logger("PushWorker");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  const config = app.get<RuntimeConfig>(RUNTIME_CONFIG);
  if (!config.pushDispatchEnabled) {
    logger.error("PUSH_DISPATCH_ENABLED must be true for the separate worker process");
    await app.close();
    process.exitCode = 1;
    return;
  }
  const dispatcher = app.get(PushDispatcherService);
  let stopping = false;
  process.on("SIGTERM", () => { stopping = true; });
  process.on("SIGINT", () => { stopping = true; });
  logger.log("Durable Expo push dispatcher started");
  while (!stopping) {
    try {
      await dispatcher.tick();
    } catch {
      // No notification token, provider response or personal data in logs.
      logger.error("Push dispatcher iteration failed; scheduled for next retry");
    }
    if (!stopping) await new Promise<void>(resolve => setTimeout(resolve, LOOP_MS));
  }
  await app.close();
}
void main().catch(() => { process.exitCode = 1; });
