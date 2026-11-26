import { describe, expect, it } from "bun:test";

import { nextPath, signInUrlFor } from "./next-path";

describe("nextPath", () => {
  it("keeps a path on this origin, query and all", () => {
    expect(nextPath("/device?user_code=ABCD1234")).toBe(
      "/device?user_code=ABCD1234"
    );
  });

  it("falls back to the home route when there is no next", () => {
    expect(nextPath(undefined)).toBe("/");
    expect(nextPath("")).toBe("/");
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\\/evil.example",
    "javascript:alert(1)",
    "/\t/evil.example",
    "device",
    "/..//evil.example",
    "/.//evil.example",
    "/%2e%2e//evil.example",
    "/%2E//evil.example",
    "/a/..//evil.example",
    "/..//evil.example/x?y#z",
  ])("falls back to the home route for %j", (next) => {
    expect(nextPath(next)).toBe("/");
  });

  it.each([
    ["/a/../b", "/b"],
    ["/a/./b?x=1#h", "/a/b?x=1#h"],
    ["/a/b/../../c", "/c"],
  ])("resolves the dot segments of %j", (next, expected) => {
    expect(nextPath(next)).toBe(expected);
  });
});

describe("signInUrlFor", () => {
  it("carries the path, query included, through nextPath unchanged", () => {
    const url = signInUrlFor("/device?user_code=ABCD1234");
    const next = new URL(url, "http://x").searchParams.get("next") ?? undefined;

    expect(url.startsWith("/sign-in?next=")).toBe(true);
    expect(nextPath(next)).toBe("/device?user_code=ABCD1234");
  });
});
