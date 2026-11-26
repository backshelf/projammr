import { describe, expect, it } from "bun:test";
import { applyMutation, defineMutation, onInvalidated } from "./mutation";

const fakeRouter = () => {
  let calls = 0;
  return {
    refresh: () => calls++,
    get calls() {
      return calls;
    },
  };
};

describe("applyMutation", () => {
  it("applies route invalidation only on success", async () => {
    const router = fakeRouter();
    const succeeding = defineMutation(
      async () => ({ ok: true }) as const,
      ["route"]
    );

    await applyMutation(succeeding, router);
    expect(router.calls).toBe(1);

    const failing = defineMutation(async () => ({ error: "nope" }), ["route"]);

    await applyMutation(failing, router);
    expect(router.calls).toBe(1);
  });

  it("notifies subscribers of a store key and stops after unsubscribe", async () => {
    const router = fakeRouter();
    let notified = 0;
    const unsubscribe = onInvalidated("collection-tracks", () => notified++);

    const mutation = defineMutation(
      async () => ({ ok: true }) as const,
      ["collection-tracks"]
    );

    await applyMutation(mutation, router);
    expect(notified).toBe(1);
    expect(router.calls).toBe(0);

    unsubscribe();
    await applyMutation(mutation, router);
    expect(notified).toBe(1);
  });

  it("an empty invalidates list refreshes nothing", async () => {
    const router = fakeRouter();
    let notified = 0;
    onInvalidated("collection-tracks", () => notified++);

    const mutation = defineMutation(async () => ({ ok: true }) as const, []);

    await applyMutation(mutation, router);
    expect(router.calls).toBe(0);
    expect(notified).toBe(0);
  });
});
