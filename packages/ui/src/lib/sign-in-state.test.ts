import { describe, expect, it } from "bun:test";
import { signInState } from "./sign-in-state";

describe("signInState", () => {
  it("asks for the first account when nobody has claimed the instance", () => {
    expect(signInState({ hasUsers: false, registration: "open" })).toEqual({
      kind: "first-account",
      hideRegister: false,
      defaultTab: "register",
    });
  });

  it("hides registering once a closed instance has accounts", () => {
    expect(signInState({ hasUsers: true, registration: "closed" })).toEqual({
      kind: "closed",
      hideRegister: true,
      defaultTab: "login",
    });
  });

  it("offers sign in or register once an open instance has accounts", () => {
    expect(signInState({ hasUsers: true, registration: "open" })).toEqual({
      kind: "open",
      hideRegister: false,
      defaultTab: "login",
    });
  });

  // The bootstrap leaves `registration` at its "open" default until the first
  // account closes it, so a fresh instance would otherwise misread as the
  // ordinary open case.
  it("lets a missing first account win over the registration setting", () => {
    expect(signInState({ hasUsers: false, registration: "closed" }).kind).toBe(
      "first-account"
    );
  });
});
