import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../lib/types";

/**
 * Echoes the inbound or freshly-minted `requestId` back to the client as
 * an `X-Request-Id` response header. Paired with `hono/request-id`'s
 * accept-inbound behaviour, this gives every response a stable id that
 * (a) appears in the log line (`loggingMiddleware`) and (b) the client can
 * quote back when reporting a failure.
 */
export const propagateRequestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  const id = c.get("requestId");
  if (id && !c.res.headers.has("X-Request-Id"))
    c.res.headers.set("X-Request-Id", id);
};
