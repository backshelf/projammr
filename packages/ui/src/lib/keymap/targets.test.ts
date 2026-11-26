import { describe, expect, it } from "bun:test";
import { isActivationTarget, isTypingTarget } from "./targets";

type FakeTarget = {
  tagName: string;
  isContentEditable?: boolean;
  role?: string;
};

function elementFrom(target: FakeTarget) {
  return {
    tagName: target.tagName,
    isContentEditable: target.isContentEditable ?? false,
    getAttribute: (name: string) =>
      name === "role" ? (target.role ?? null) : null,
  } as unknown as HTMLElement;
}

describe("isTypingTarget", () => {
  it("recognises an input, a textarea and a select", () => {
    expect(isTypingTarget(elementFrom({ tagName: "INPUT" }))).toBe(true);
    expect(isTypingTarget(elementFrom({ tagName: "TEXTAREA" }))).toBe(true);
    expect(isTypingTarget(elementFrom({ tagName: "SELECT" }))).toBe(true);
  });

  it("recognises a contenteditable element", () => {
    expect(
      isTypingTarget(elementFrom({ tagName: "DIV", isContentEditable: true }))
    ).toBe(true);
  });

  it("leaves an ordinary element alone", () => {
    expect(isTypingTarget(elementFrom({ tagName: "DIV" }))).toBe(false);
  });

  it("answers false for a null target", () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("isActivationTarget", () => {
  it("recognises a button and a link", () => {
    expect(isActivationTarget(elementFrom({ tagName: "BUTTON" }))).toBe(true);
    expect(isActivationTarget(elementFrom({ tagName: "A" }))).toBe(true);
  });

  it("recognises any element carrying a role", () => {
    expect(
      isActivationTarget(elementFrom({ tagName: "DIV", role: "slider" }))
    ).toBe(true);
  });

  it("leaves Enter on a grid cell to the grid's own keys", () => {
    expect(
      isActivationTarget(
        elementFrom({ tagName: "TD", role: "gridcell" }),
        "Enter"
      )
    ).toBe(false);
  });

  it("keeps space on a grid cell, as on any other role", () => {
    const cell = elementFrom({ tagName: "TD", role: "gridcell" });
    expect(isActivationTarget(cell, "space")).toBe(true);
    expect(isActivationTarget(cell)).toBe(true);
  });

  it("leaves an ordinary element alone", () => {
    expect(isActivationTarget(elementFrom({ tagName: "DIV" }))).toBe(false);
  });

  it("answers false for a null target", () => {
    expect(isActivationTarget(null)).toBe(false);
  });
});
