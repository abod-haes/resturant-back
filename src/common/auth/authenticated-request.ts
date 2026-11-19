import type { IncomingMessage } from "node:http";
import type { AuthPrincipal } from "./principal";

export interface AuthenticatedRequest extends IncomingMessage {
  principal?: AuthPrincipal;
  requestId?: string;
  params?: Record<string, string>;
}
