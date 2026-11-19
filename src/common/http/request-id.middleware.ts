import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface RequestWithId extends IncomingMessage {
  requestId?: string;
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function requestIdMiddleware(req: RequestWithId, res: ServerResponse, next: () => void): void {
  const incoming = req.headers["x-request-id"];
  req.requestId = typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader("x-request-id", req.requestId);
  next();
}
