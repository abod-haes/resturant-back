import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { configureHttpApp } from "../../src/bootstrap";
import { DatabaseService } from "../../src/database/database.service";

describe("health endpoints", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureHttpApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves liveness with a request ID", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/health/live").expect(200);
    expect(response.body).toEqual({ data: { status: "ok" } });
    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
  });

  it("returns ready only if PostgreSQL responds", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/health/ready").expect(200);
    expect(response.body).toEqual({ data: { status: "ready", database: "up" } });
  });

  it("returns 503 when PostgreSQL is unreachable", async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue({ ping: async () => Promise.reject(new Error("connection refused")) })
      .compile();
    const offlineApp = module.createNestApplication();
    configureHttpApp(offlineApp);
    await offlineApp.init();

    try {
      const response = await request(offlineApp.getHttpServer()).get("/api/v1/health/ready").expect(503);
      expect(response.body.error.code).toBe("SERVICE_UNAVAILABLE");
      expect(response.body.requestId).toEqual(response.headers["x-request-id"]);
    } finally {
      await offlineApp.close();
    }
  });
});
