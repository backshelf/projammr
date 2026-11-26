import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const { effectiveSettings } = await import("@/lib/settings/effective");
const layers = new Map([
  [undefined, effectiveSettings({ "lab.normaliseTarget": -12 }, "v1")],
  [7, effectiveSettings({ "lab.normaliseTarget": -9 }, "v2")],
]);
mock.module("@/lib/settings/server", () => ({
  cachedEffectiveSettings: async (projectId?: number) => layers.get(projectId),
}));

const { cachedPolicies } = await import("./server");

describe("cachedPolicies", () => {
  it("builds the viewer's policies without a project", async () => {
    expect((await cachedPolicies()).lab.normaliseTargetLufs).toBe(-12);
  });

  it("builds a project's policies from the project's layer", async () => {
    expect((await cachedPolicies(7)).lab.normaliseTargetLufs).toBe(-9);
  });
});
