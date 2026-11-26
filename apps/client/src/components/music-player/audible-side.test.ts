import { describe, expect, it } from "bun:test";
import { audibleSide, comparedSide } from "./audible-side";

describe("audibleSide", () => {
  it("reads the heard source before its chain while a comparison is ready", () => {
    expect(audibleSide({ active: "b", phase: "ready" }, true)).toBe("b");
    expect(audibleSide({ active: "a", phase: "ready" }, true)).toBe("a");
  });

  it("reads the Lab's output while it plays without a ready comparison", () => {
    expect(audibleSide(null, true)).toBe("mix");
    expect(audibleSide({ active: "a", phase: "preparing" }, true)).toBe("mix");
  });

  it("reads the element's own tap while the Lab is off", () => {
    expect(audibleSide(null, false)).toBe("a");
    expect(audibleSide({ active: "a", phase: "preparing" }, false)).toBe("a");
  });
});

describe("comparedSide", () => {
  it("is the source not heard while a comparison is ready, else none", () => {
    expect(comparedSide({ active: "a", phase: "ready" })).toBe("b");
    expect(comparedSide({ active: "b", phase: "ready" })).toBe("a");
    expect(comparedSide({ active: "a", phase: "preparing" })).toBeNull();
    expect(comparedSide(null)).toBeNull();
  });
});
