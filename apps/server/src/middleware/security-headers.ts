import { SECURITY_HEADERS } from "@workspace/security-headers";
import { createMiddleware } from "hono/factory";
import { publicTlsMode } from "../lib/env.js";

/**
 * The site-wide floor on every response from this process — `/api`, the
 * `/media` files and the API's own `/docs` page — the same set the web app
 * sends on its pages.
 */
export const securityHeaders = createMiddleware(async (c, next) => {
  await next();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    c.header(name, value);
  }
  // Self-signed deployments (`tls internal`) must never send this: a browser
  // that remembers HSTS for a CA nobody outside the LAN trusts can be locked
  // out the next time that CA changes.
  if (publicTlsMode) {
    c.header(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains"
    );
  }
});
