import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { AuthedEnv } from "../auth.js";
import { isInstanceAdmin } from "../db/queries/authorization.js";

/**
 * Gates the instance-wide routes on `users.instanceRole`. Anyone else gets a
 * 404 rather than a 403: whether an instance has an administration surface at
 * all is not a stranger's business.
 *
 * The role is read per request, through the same `isInstanceAdmin` that gates an
 * instance-scoped write, so a promotion or a demotion takes effect on the next
 * request and the two gates cannot drift apart.
 */
export const instanceAdmin = createMiddleware<AuthedEnv>(async (c, next) => {
  if (!(await isInstanceAdmin(c.get("user").id))) {
    throw new HTTPException(404);
  }
  await next();
});
