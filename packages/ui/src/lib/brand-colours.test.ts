import { describe, expect, it } from "bun:test";
import { SETTINGS } from "@workspace/settings";
import { PAPER_DARK } from "./brand-colours";

describe("the branding settings' colours", () => {
  // The settings package cannot import this one, so the defaults it declares
  // are pinned here to the colour the manifest has always used.
  it("default to the dark theme's paper", () => {
    expect(SETTINGS["instance-branding.themeColour"].default).toBe(PAPER_DARK);
    expect(SETTINGS["instance-branding.backgroundColour"].default).toBe(
      PAPER_DARK
    );
  });
});
