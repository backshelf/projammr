import { describe, expect, it } from "bun:test";
import { buttonVariants } from "./button";
import { iconButtonVariants } from "./icon-button";

const focusClasses = (classes: string) =>
  classes.split(/\s+/).filter((name) => name.startsWith("focus-visible:"));

describe("iconButtonVariants", () => {
  it.each(["play", "icon", "hero"] as const)(
    "carries the focus-visible classes of a button on the %s variant",
    (variant) => {
      const expected = focusClasses(buttonVariants());
      expect(expected.length).toBeGreaterThan(0);
      expect(focusClasses(iconButtonVariants({ variant }))).toEqual(expected);
    }
  );
});
