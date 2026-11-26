import { Hono } from "hono";
import { auth, type AuthType } from "../auth.js";

const router = new Hono<{ Bindings: AuthType }>({ strict: false });

router.on(["POST", "GET"], "/*", (c) => {
  return auth.handler(c.req.raw);
});

export default router;
