import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { MediaService } from "./modules/media/application/media.service";

/** Optional Dokploy cron command. Safe to rerun; one bounded 100-asset batch. */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error","warn","log"] });
  try {
    const result = await app.get(MediaService).cleanup();
    new Logger("MediaCleanup").log(JSON.stringify(result));
    if (result.failed) process.exitCode = 1;
  } finally {
    await app.close();
  }
}
void main().catch(() => { process.exitCode = 1; });
