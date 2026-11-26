import { describe, expect, it } from "bun:test";
import {
  isOnlyEnabledAdmin,
  resetLinkDialogReducer,
} from "./admin-users-logic";

const user = (
  id: string,
  instanceRole: "admin" | "user",
  disabled = false
) => ({ id, instanceRole, disabled });

describe("isOnlyEnabledAdmin", () => {
  it("is true for the one enabled admin on the page", () => {
    const page = [user("a", "admin"), user("b", "user")];

    expect(isOnlyEnabledAdmin(page[0]!, page)).toBe(true);
  });

  it("is false once a second enabled admin exists", () => {
    const page = [user("a", "admin"), user("b", "admin")];

    expect(isOnlyEnabledAdmin(page[0]!, page)).toBe(false);
    expect(isOnlyEnabledAdmin(page[1]!, page)).toBe(false);
  });

  it("is false for a plain user, even the only account on the page", () => {
    const page = [user("a", "user")];

    expect(isOnlyEnabledAdmin(page[0]!, page)).toBe(false);
  });

  it("is false for a disabled admin — they are not who the instance signs in as", () => {
    const page = [user("a", "admin", true), user("b", "user")];

    expect(isOnlyEnabledAdmin(page[0]!, page)).toBe(false);
  });
});

describe("resetLinkDialogReducer", () => {
  it("shows the newly minted link", () => {
    const state = resetLinkDialogReducer(null, {
      type: "shown",
      userId: "u1",
      url: "https://x/reset-password?token=a",
    });

    expect(state).toEqual({
      userId: "u1",
      url: "https://x/reset-password?token=a",
    });
  });

  it("clears the link on close, so it cannot be re-shown without minting a new one", () => {
    const shown = resetLinkDialogReducer(null, {
      type: "shown",
      userId: "u1",
      url: "https://x/reset-password?token=a",
    });

    expect(resetLinkDialogReducer(shown, { type: "closed" })).toBeNull();
  });

  it("replaces rather than retains the previous link once a second one is minted", () => {
    const first = resetLinkDialogReducer(null, {
      type: "shown",
      userId: "u1",
      url: "https://x/reset-password?token=a",
    });
    const closed = resetLinkDialogReducer(first, { type: "closed" });
    const second = resetLinkDialogReducer(closed, {
      type: "shown",
      userId: "u1",
      url: "https://x/reset-password?token=b",
    });

    expect(second?.url).toBe("https://x/reset-password?token=b");
    expect(second?.url).not.toBe(first?.url);
  });
});
