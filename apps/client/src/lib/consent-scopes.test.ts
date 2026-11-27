import { describe, expect, it } from "bun:test";

import { consentChoices, grantedScope } from "./consent-scopes";

describe("consentChoices", () => {
  it("splits the required scope from the optional ones", () => {
    expect(consentChoices("read write")).toEqual({
      fixed: ["read"],
      optional: ["write"],
    });
  });

  it("treats offline_access as an optional scope", () => {
    expect(consentChoices("read write offline_access")).toEqual({
      fixed: ["read"],
      optional: ["write", "offline_access"],
    });
  });

  it("treats an unknown scope as optional", () => {
    expect(consentChoices("read admin")).toEqual({
      fixed: ["read"],
      optional: ["admin"],
    });
  });
});

describe("grantedScope", () => {
  it("drops an optional scope the user unticked", () => {
    expect(grantedScope("read write", new Set())).toBe("read");
  });

  it("keeps an optional scope that stayed ticked", () => {
    expect(grantedScope("read write", new Set(["write"]))).toBe("read write");
  });

  it("preserves offline_access when ticked and drops it when unticked", () => {
    expect(
      grantedScope(
        "read write offline_access",
        new Set(["write", "offline_access"])
      )
    ).toBe("read write offline_access");
    expect(grantedScope("read write offline_access", new Set(["write"]))).toBe(
      "read write"
    );
  });
});
