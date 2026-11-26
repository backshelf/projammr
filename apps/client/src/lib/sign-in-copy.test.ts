import { describe, expect, it } from "bun:test";
import { signInCopy } from "./sign-in-copy";

describe("signInCopy", () => {
  it("words the first-account state as a bootstrap", () => {
    const copy = signInCopy({ hasUsers: false, registration: "open" });

    expect(copy.title).toBe("Create the first account");
    expect(copy.defaultTab).toBe("register");
  });

  it("explains invite-only access once registration is closed", () => {
    const copy = signInCopy({ hasUsers: true, registration: "closed" });

    expect(copy.hideRegister).toBe(true);
    expect(copy.description).toContain("invite");
  });

  it("offers the ordinary sign in or register card once the instance is open", () => {
    const copy = signInCopy({ hasUsers: true, registration: "open" });

    expect(copy.title).toBe("Sign in or create an account");
    expect(copy.hideRegister).toBe(false);
  });
});
