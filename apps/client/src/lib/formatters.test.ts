import { beforeEach, describe, expect, it, mock } from "bun:test";
import * as React from "react";

mock.module("server-only", () => ({}));

const get = mock<(name: string) => { value: string } | undefined>();
const cookies = mock(async () => ({ get }));
mock.module("next/headers", () => ({ cookies }));

// React's own `cache` memoises only inside a server render; outside one it
// calls straight through. This stands in for one request's worth of it.
const memos: Map<string, unknown>[] = [];
mock.module("react", () => ({
  ...React,
  cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
    const memo = new Map<string, R>();
    memos.push(memo);
    return (...args: A): R => {
      const id = JSON.stringify(args);
      if (!memo.has(id)) memo.set(id, fn(...args));
      return memo.get(id)!;
    };
  },
}));

const { DEFAULT_EFFECTIVE_SETTINGS, effectiveSettings } =
  await import("@/lib/settings/effective");
let settings = DEFAULT_EFFECTIVE_SETTINGS;
let projectSettings = new Map<number, typeof settings>();
mock.module("@/lib/settings/server", () => ({
  cachedEffectiveSettings: async (projectId?: number) =>
    (projectId === undefined ? undefined : projectSettings.get(projectId)) ??
    settings,
}));

const { cachedFormatters, viewerFormat } = await import("./formatters");
const { DEFAULT_FORMAT_PREFS, runtimeZone } =
  await import("@workspace/ui/lib/formatters");

/** A new request: nothing cached, and the cookie jar it carries. */
function request(cookie?: string) {
  settings = DEFAULT_EFFECTIVE_SETTINGS;
  projectSettings = new Map();
  for (const memo of memos) memo.clear();
  cookies.mockClear();
  get.mockReset();
  get.mockImplementation((name) =>
    name === "viewer_zone" && cookie !== undefined
      ? { value: cookie }
      : undefined
  );
}

beforeEach(() => request());

describe("viewerFormat", () => {
  it("resolves auto to the zone the browser wrote into its cookie", async () => {
    request("Asia/Tokyo");

    expect(await viewerFormat()).toEqual({
      prefs: DEFAULT_FORMAT_PREFS,
      zone: "Asia/Tokyo",
    });
  });

  it("writes in the viewer's own format settings", async () => {
    settings = effectiveSettings(
      { "formats.clock": "12h", "formats.weekStart": "monday" },
      "v1"
    );

    expect((await viewerFormat()).prefs).toEqual({
      ...DEFAULT_FORMAT_PREFS,
      clock: "12h",
      weekStart: 1,
    });
  });

  it("writes in a project's format settings when given the project", async () => {
    settings = effectiveSettings({ "formats.weekStart": "monday" }, "v1");
    projectSettings.set(
      7,
      effectiveSettings(
        { "formats.weekStart": "saturday", "formats.clock": "12h" },
        "v2"
      )
    );

    expect((await viewerFormat(7)).prefs).toEqual({
      ...DEFAULT_FORMAT_PREFS,
      clock: "12h",
      weekStart: 6,
    });
    expect((await viewerFormat()).prefs.weekStart).toBe(1);
  });

  it("falls back to the server's own zone before the browser has written one", async () => {
    expect((await viewerFormat()).zone).toBe(runtimeZone());
  });

  it("ignores a cookie that names no zone", async () => {
    request("Mars/Olympus");

    expect((await viewerFormat()).zone).toBe(runtimeZone());
  });
});

describe("cachedFormatters", () => {
  it("formats in the cookie's zone", async () => {
    request("Asia/Tokyo");

    const format = await cachedFormatters();
    expect(format.timeZone).toBe("Asia/Tokyo");
    expect(format.time("2026-08-03T14:05:00Z")).toBe("23:05");
  });

  it("formats in a project's time zone, and each project gets its own set", async () => {
    request("Asia/Tokyo");
    projectSettings.set(
      7,
      effectiveSettings({ "formats.timeZone": "Europe/London" }, "v1")
    );

    const project = await cachedFormatters(7);
    const global = await cachedFormatters();

    expect(project.timeZone).toBe("Europe/London");
    expect(global.timeZone).toBe("Asia/Tokyo");
    expect(await cachedFormatters(7)).toBe(project);
  });

  it("reads the cookie and builds the set once per request", async () => {
    request("Asia/Tokyo");

    const [first, second] = await Promise.all([
      cachedFormatters(),
      cachedFormatters(),
    ]);
    await viewerFormat();

    expect(second).toBe(first);
    expect(cookies).toHaveBeenCalledTimes(1);
  });

  it("builds a fresh set for the next request", async () => {
    request("Asia/Tokyo");
    const tokyo = await cachedFormatters();

    request("Europe/London");
    const london = await cachedFormatters();

    expect(london).not.toBe(tokyo);
    expect(london.timeZone).toBe("Europe/London");
  });
});
