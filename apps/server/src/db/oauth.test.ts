import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "bun:test";
import { db } from "./index.js";
import { oauthClients } from "./schema/oauth.js";

/**
 * Proves the generated migration actually applied: a row round-trips through
 * `db` on the plain Drizzle table, the same one the adapter map in `auth.ts`
 * hands to Better Auth once the provider plugin is configured.
 */
describe("oauth_clients", () => {
  const id = crypto.randomUUID();
  const clientId = `oauth-schema-test-${id}`;

  afterAll(async () => {
    await db.delete(oauthClients).where(eq(oauthClients.id, id));
  });

  it("inserts and reads back a client row", async () => {
    await db.insert(oauthClients).values({
      id,
      clientId,
      redirectUris: ["https://example.com/callback"],
      scopes: ["read", "write"],
    });

    const [row] = await db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.id, id));

    expect(row).toMatchObject({
      id,
      clientId,
      redirectUris: ["https://example.com/callback"],
      scopes: ["read", "write"],
      disabled: false,
      clientCredentialsScopes: [],
    });
  });
});
