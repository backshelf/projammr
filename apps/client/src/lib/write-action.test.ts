import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const refresh = mock();
mock.module("next/cache", () => ({ refresh }));

const { written } = await import("./write-action");

beforeEach(() => {
  refresh.mockReset();
});

describe("written", () => {
  it("refreshes after a successful write", async () => {
    const result = await written(Promise.resolve({ ok: true }));

    expect(result).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh after a failed write", async () => {
    const result = await written(Promise.resolve({ error: "nope" }));

    expect(result).toEqual({ error: "nope" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("propagates a rejection without refreshing", async () => {
    await expect(
      written(Promise.reject(new Error("db unavailable")))
    ).rejects.toThrow("db unavailable");
    expect(refresh).not.toHaveBeenCalled();
  });
});
