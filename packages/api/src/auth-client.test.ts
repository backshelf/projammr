import { afterAll, describe, expect, it } from "bun:test";
import { stubGlobal, unstubAllGlobals } from "@workspace/test/globals";

/**
 * The shared client must survive being imported by a page whose origin is not
 * a valid base URL. A packaged desktop renderer can be exactly that: Electron
 * loads it with `loadFile`, so its origin is `file://`, and better-auth throws
 * `Invalid base URL: file://` when it falls back to the page origin. The
 * a desktop app imports this module only because `@workspace/ui`'s login form names
 * `authClient` as the default for its injectable client prop — it signs in over
 * IPC and never calls it. Constructing on import made that import fatal.
 *
 * The two cases run in order on purpose: the module is evaluated under the
 * `file://` origin and only used under an http one. That the second still gets
 * a working client is the proof that nothing was built during the first.
 */
describe("the shared auth client is built on first use", () => {
  afterAll(() => {
    unstubAllGlobals();
  });

  it("imports at a file:// origin without constructing a client", async () => {
    stubGlobal("window", { location: { origin: "file://" } });

    const module = await import("./auth-client");

    // Reading the export off the namespace does not touch the proxy; awaiting
    // or inspecting the client itself would probe it for `then` and build one.
    expect(Object.hasOwn(module, "authClient")).toBe(true);
  });

  it("builds the client from the origin in place when it is first touched", async () => {
    stubGlobal("window", { location: { origin: "http://localhost:3000" } });

    const { authClient } = await import("./auth-client");

    expect(typeof authClient.signIn.email).toBe("function");
    // `signIn.anonymous` comes from `anonymousClient()`: the proxy has to carry
    // the plugin methods through, not just the base client's.
    expect(typeof authClient.signIn.anonymous).toBe("function");
  });
});
