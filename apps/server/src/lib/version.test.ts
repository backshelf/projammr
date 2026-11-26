import { describe, expect, it } from "bun:test";
import pkg from "../../package.json" with { type: "json" };
import { readAppVersion } from "./version.js";

describe("readAppVersion", () => {
  it("takes APP_VERSION when it is set", () => {
    expect(readAppVersion({ APP_VERSION: "1.2.3" })).toBe("1.2.3");
  });

  it("falls back to the package version when APP_VERSION is empty", () => {
    expect(readAppVersion({ APP_VERSION: "" })).toBe(pkg.version);
  });

  it("falls back to the package version when APP_VERSION is unset", () => {
    expect(readAppVersion({})).toBe(pkg.version);
  });
});
