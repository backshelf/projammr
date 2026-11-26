import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { RequestIdVariables } from "hono/request-id";
import type { AuthType } from "../auth.js";
import { log } from "../lib/log.js";

const logger = log("http");

type RequestEnv = { Variables: AuthType & RequestIdVariables };

/**
 * Requests a client repeats on a timer or holds open: a project's jobs and its
 * job event stream, and a machine's beat. They succeed at `debug`,
 * because a line each at `info` would bury every other request.
 */
const QUIET_PATHS = [
  /^\/api\/projects\/\d+\/jobs(?:\/events)?$/,
  /^\/api\/machines\/[^/]+$/,
];

function finish(c: Context<RequestEnv>, start: number, status: number) {
  const line = {
    method: c.req.method,
    path: c.req.path,
    status,
    ms: Number((performance.now() - start).toFixed(2)),
    requestId: c.get("requestId"),
    userId: c.get("user")?.id,
  };

  if (status >= 500) logger.error("request", line);
  else if (status >= 400) logger.warn("request", line);
  else if (QUIET_PATHS.some((path) => path.test(line.path))) {
    logger.debug("request", line);
  } else logger.info("request", line);
}

/**
 * One line per request, written once the response is known. A handler that
 * threw has no response yet — `app.onError` builds it after this middleware
 * has already unwound — so the status is taken from the error instead.
 */
export const requestLog = createMiddleware<RequestEnv>(async (c, next) => {
  const start = performance.now();

  try {
    await next();
  } catch (err) {
    finish(c, start, err instanceof HTTPException ? err.status : 500);
    throw err;
  }

  finish(c, start, c.res.status);
});
