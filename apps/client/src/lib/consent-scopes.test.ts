import { describe, expect, it } from "bun:test";

import { consentChoices, grantedScope } from "./consent-scopes";

describe("consentChoices", () => {
  it("splits the required scope from the optional ones", () => {
    expect(consentChoices("read write")).toEqual({
      fixed: ["read"],
      optional: ["write"],
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
});
