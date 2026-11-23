import { readFileSync } from "node:fs";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { parseDocument } from "yaml";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { configureHttpApp } from "../../src/bootstrap";

/**
 * Every route in the maintained 96-operation reference must appear in
 * Nest-generated Swagger. Conversely, newly added live routes must be
 * documented in the versioned reference before they can ship.
 */
describe("Complete executable Swagger coverage (PostgreSQL)", () => {
  let app: INestApplication;
  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") throw new Error("Swagger test requires NODE_ENV=test");
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureHttpApp(app);
    await app.init();
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it("serves interactive Swagger and the whole generated OpenAPI JSON", async () => {
    const ui = await request(app.getHttpServer()).get("/api/docs");
    expect(ui.status).toBe(200);
    expect(ui.text).toContain("swagger-ui");
    const response = await request(app.getHttpServer()).get("/api/docs-json");
    expect(response.status).toBe(200);
    expect(response.body.openapi).toMatch(/^3\./);
    expect(response.body.info.title).toBe("Restaurant Platform API");
    expect(response.body.components.schemas.ApiErrorEnvelope).toBeDefined();
    expect(response.body.components.securitySchemes.bearer).toBeDefined();
    expect(response.body.paths["/api/v1/admin/audit-logs"]).toBeUndefined();
    expect(response.body.paths["/api/v1/auth/change-password"]?.post).toBeDefined();
  });

  it("keeps canonical YAML and Nest runtime operation inventories in exact parity", async () => {
    const response = await request(app.getHttpServer()).get("/api/docs-json");
    expect(response.status).toBe(200);
    const runtime = response.body as {
      paths: Record<string, Record<string, { tags?: string[]; responses?: Record<string, unknown> }>>;
    };
    const yaml = parseDocument(readFileSync("openapi/restaurant.v1.yaml", "utf8"), {
      uniqueKeys: true, strict: true,
    });
    expect(yaml.errors).toHaveLength(0);
    const reference = yaml.toJS() as { paths: Record<string, Record<string, unknown>> };
    const methods = ["get", "post", "put", "patch", "delete"];
    const referenceOperations = new Set<string>(), runtimeOperations = new Set<string>();

    for (const [path, operations] of Object.entries(reference.paths)) {
      for (const method of methods) {
        if (operations[method]) referenceOperations.add(method.toUpperCase() + " " + path);
      }
    }
    for (const [fullPath, operations] of Object.entries(runtime.paths)) {
      expect(fullPath.startsWith("/api/v1/")).toBe(true);
      const path = fullPath.slice("/api/v1".length);
      for (const method of methods) {
        const operation = operations[method];
        if (!operation) continue;
        runtimeOperations.add(method.toUpperCase() + " " + path);
        expect(operation.tags?.length).toBeGreaterThan(0);
        expect(operation.responses?.default).toMatchObject({
          content: { "application/json": {
            schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
          } },
        });
        expect(Object.keys(operation.responses ?? {}).some(status => /^2\d\d$/.test(status))).toBe(true);
      }
    }
    expect([...runtimeOperations].sort()).toEqual([...referenceOperations].sort());
    expect(runtimeOperations.size).toBeGreaterThanOrEqual(90);
  });
});
