import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema/auth.js";
import { setupSuite, signUpAndSignIn } from "../test/fixtures.js";
import { actorFrom, authInfoFor, loadActor } from "./actor.js";

const { owner, requireProject } = setupSuite("MCP actor");

describe("loadActor", () => {
  it("loads the users row a token's subject claim names, with the granted scopes", async () => {
    requireProject();
    const actor = await loadActor({ sub: owner.userId, scope: "read write" });
    expect(actor.id).toBe(owner.userId);
    expect(actor.user.id).toBe(owner.userId);
    expect(actor.scopes).toEqual(new Set(["read", "write"]));
  });

  it("drops a scope claim the provider does not grant", async () => {
    requireProject();
    const actor = await loadActor({ sub: owner.userId, scope: "read admin" });
    expect(actor.scopes).toEqual(new Set(["read"]));
  });

  it("throws 401 when no row matches the claimed subject", async () => {
    await expect(
      loadActor({ sub: "no-such-user", scope: "read" })
    ).rejects.toMatchObject({ status: 401 });
  });

  it("throws 401 when the subject claim is missing", async () => {
    await expect(loadActor({})).rejects.toMatchObject({ status: 401 });
  });

  it("throws 401 when the user account is disabled", async () => {
    const disabled = await signUpAndSignIn("MCP disabled actor");
    await db
      .update(users)
      .set({ disabledAt: new Date() })
      .where(eq(users.id, disabled.userId));

    await expect(
      loadActor({ sub: disabled.userId, scope: "read write" })
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("authInfoFor / actorFrom", () => {
  it("round-trips the actor through authInfo.extra", async () => {
    requireProject();
    const actor = await loadActor({ sub: owner.userId, scope: "read" });
    const authInfo = authInfoFor(
      actor,
      { sub: owner.userId, client_id: "client-1" },
      "tok"
    );

    expect(authInfo.token).toBe("tok");
    expect(authInfo.clientId).toBe("client-1");
    expect(authInfo.scopes).toEqual(["read"]);
    expect(actorFrom(authInfo)).toEqual(actor);
  });

  it("falls back to the azp claim when client_id is absent", async () => {
    requireProject();
    const actor = await loadActor({ sub: owner.userId, scope: "read" });
    const authInfo = authInfoFor(
      actor,
      { sub: owner.userId, azp: "client-2" },
      "tok"
    );
    expect(authInfo.clientId).toBe("client-2");
  });

  it("throws when authInfo carries no actor", () => {
    expect(() =>
      actorFrom({ token: "t", clientId: "c", scopes: [] })
    ).toThrow();
  });
});
