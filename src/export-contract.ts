import "reflect-metadata";
import { mkdir, writeFile } from "node:fs/promises";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureHttpApp } from "./bootstrap";
import { buildApiDocument } from "./common/openapi/api-document";

/** Export the *actual executable* Nest controller/DTO OpenAPI contract. */
async function exportContract(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    configureHttpApp(app);
    const document = buildApiDocument(app);
    const methods = ["get", "post", "put", "patch", "delete"] as const;
    const operations = Object.values(document.paths).reduce((count, pathItem) =>
      count + methods.filter(method => pathItem?.[method]).length, 0);

    if (operations < 90) {
      throw new Error("Refusing incomplete OpenAPI contract export");
    }
    await mkdir("artifacts", { recursive: true });
    await writeFile(
      "artifacts/restaurant.openapi.json",
      JSON.stringify(document, null, 2) + "\n",
      { encoding: "utf8", flag: "w" },
    );
    console.log("Exported "+operations+" implemented HTTP operations to artifacts/restaurant.openapi.json");
  } finally {
    await app.close();
  }
}

void exportContract().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "OpenAPI export failed");
  process.exitCode = 1;
});
