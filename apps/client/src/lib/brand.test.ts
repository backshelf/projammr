import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

/*
 * React's `cache` memoises only inside a server render, so this stands in for
 * one: an entry per argument list that lasts until `nextRequest()`.
 */
let request = new Map<unknown, Map<string, unknown>>();
const nextRequest = () => {
  request = new Map();
};
const react = await import("react");
mock.module("react", () => ({
  ...react,
  cache:
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    (...args: A): R => {
      const entries = request.get(fn) ?? new Map<string, unknown>();
      request.set(fn, entries);
      const key = JSON.stringify(args);
      if (!entries.has(key)) entries.set(key, fn(...args));
      return entries.get(key) as R;
    },
}));

const cachedInstance = mock<() => Promise<unknown>>();
mock.module("@/lib/server-data", () => ({ cachedInstance }));

const { cachedBrand } = await import("./brand");
const { DEFAULT_BRAND } = await import("./brand-defaults");

const brand = {
  name: "Riverside Sessions",
  logoImageId: 12,
  iconImageId: null,
  // eslint-disable-next-line no-restricted-syntax -- the brand's own colours, stored as hex, not a class name
  themeColour: "#123456",
  // eslint-disable-next-line no-restricted-syntax -- the brand's own colours, stored as hex, not a class name
  backgroundColour: "#654321",
  logoImagePath: "logos/riverside.webp",
  iconImagePath: null,
};

beforeEach(() => {
  nextRequest();
  cachedInstance.mockReset();
});

describe("cachedBrand", () => {
  it("reads the instance's own brand", async () => {
    cachedInstance.mockResolvedValue({ brand });

    expect(await cachedBrand()).toEqual(brand);
  });

  it("falls back to the registry defaults when the instance read fails", async () => {
    cachedInstance.mockResolvedValue({ error: "Failed to read the instance" });

    expect(await cachedBrand()).toEqual(DEFAULT_BRAND);
  });

  it("falls back to the registry defaults when the API is unreachable", async () => {
    cachedInstance.mockRejectedValue(new TypeError("fetch failed"));

    expect(await cachedBrand()).toEqual(DEFAULT_BRAND);
  });

  it("reads once per request", async () => {
    cachedInstance.mockResolvedValue({ brand });

    await Promise.all([cachedBrand(), cachedBrand()]);

    expect(cachedInstance).toHaveBeenCalledTimes(1);
  });
});
