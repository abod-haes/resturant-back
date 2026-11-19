import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { RequestWithId } from "./request-id.middleware";

interface HttpResponse {
  status(code: number): { json(body: unknown): void };
}

interface ErrorPayload {
  readonly code?: string;
  readonly message?: string | string[];
  readonly details?: unknown;
}

const DEFAULT_CODES: Readonly<Record<number, string>> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  410: "GONE",
  422: "VALIDATION_ERROR",
  429: "RATE_LIMITED",
  503: "SERVICE_UNAVAILABLE",
};

function isErrorPayload(value: unknown): value is ErrorPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithId>();
    const response = context.getResponse<HttpResponse>();
    const requestId = request.requestId ?? randomUUID();
    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const original = isHttpException ? exception.getResponse() : undefined;
    const payload = isErrorPayload(original) ? original : undefined;

    const rawMessage = payload?.message ?? (typeof original === "string" ? original : undefined);
    const message = status >= 500 && status !== 503
      ? "Internal server error"
      : Array.isArray(rawMessage)
        ? "Request validation failed"
        : rawMessage ?? (isHttpException ? exception.message : "Internal server error");

    const error: { code: string; message: string; details?: unknown } = {
      code: typeof payload?.code === "string" ? payload.code : DEFAULT_CODES[status] ?? "HTTP_ERROR",
      message,
    };
    if (payload?.details !== undefined && status < 500) {
      error.details = payload.details;
    } else if (Array.isArray(rawMessage) && status < 500) {
      error.details = { validationErrors: rawMessage };
    }

    if (status >= 500) {
      // Never log request bodies, authorization credentials, or QR paths/tokens.
      this.logger.error(JSON.stringify({ requestId, status, type: "http_request_failed" }));
    }

    response.status(status).json({ error, requestId });
  }
}
