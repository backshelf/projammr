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

  it("fits the default play button into a 28px table-cell slot without shrinking touch targets", () => {
    const playDefault = iconButtonVariants({ variant: "play" }).split(/\s+/);
    expect(playDefault).toContain("size-8");
    expect(playDefault).toContain("in-[td]:size-7");

    const playTouch = iconButtonVariants({
      variant: "play",
      size: "touch",
    }).split(/\s+/);
    expect(playTouch).toContain("size-11");
    expect(playTouch).not.toContain("in-[td]:size-7");
  });
});

describe("buttonVariants", () => {
  it.each(["default", "xs", "sm", "lg"] as const)(
    "scopes coarse min-h-11 out of table cells on size %s while keeping the coarse hit-area halo",
    (size) => {
      const classes = buttonVariants({ size }).split(/\s+/);
      expect(classes).toContain("coarse:min-h-11");
      expect(classes).toContain("in-[td]:coarse:min-h-0");
      expect(classes).toContain("coarse:after:-inset-2");
    }
  );
});
