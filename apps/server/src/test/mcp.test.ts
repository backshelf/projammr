import { beforeAll, describe, expect, it } from "bun:test";
import { mcpResource } from "../lib/env.js";
import { signUpAndSignIn, type Actor } from "./fixtures.js";
import { mintMcpToken } from "./mcp.js";

/** The claims of a JWT, unverified: the token came straight from the provider. */
function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

describe("mintMcpToken", () => {
  let user: Actor;

  beforeAll(async () => {
    user = await signUpAndSignIn("MCP token");
  });

  it("mints a token for the signed-in user bound to the MCP resource", async () => {
    const claims = decodeJwt(await mintMcpToken(user, ["read", "write"]));

    expect(claims.sub).toBe(user.userId);
    expect(claims.scope).toBe("read write");
    expect([claims.aud].flat()).toContain(mcpResource);
  });

  it("grants only the scopes asked for", async () => {
    const claims = decodeJwt(await mintMcpToken(user, ["read"]));

    expect(claims.scope).toBe("read");
  });
});
