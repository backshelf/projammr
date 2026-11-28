import { describe, expect, it } from "bun:test";
import {
  resolveTouchIntent,
  timelineRatioFromClientX,
  timelineYRatioFromClientY,
} from "./use-timeline-scrub";

describe("timelineRatioFromClientX", () => {
  it("clamps ratios outside the element bounds", () => {
    const rect = { left: 100, width: 200 };
    expect(timelineRatioFromClientX(50, rect)).toBe(0);
    expect(timelineRatioFromClientX(200, rect)).toBe(0.5);
    expect(timelineRatioFromClientX(400, rect)).toBe(1);
  });

  it("returns 0 when width is 0", () => {
    expect(timelineRatioFromClientX(50, { left: 0, width: 0 })).toBe(0);
  });
});

describe("timelineYRatioFromClientY", () => {
  it("maps top to 0 and bottom to 1", () => {
    const rect = { top: 20, height: 100 };
    expect(timelineYRatioFromClientY(20, rect)).toBe(0);
    expect(timelineYRatioFromClientY(70, rect)).toBe(0.5);
    expect(timelineYRatioFromClientY(150, rect)).toBe(1);
  });
});

describe("resolveTouchIntent", () => {
  it("yields vertical touch swipes to scroll and locks horizontal drags to scrub", () => {
    expect(resolveTouchIntent(2, 12, "touch")).toBe("scroll");
    expect(resolveTouchIntent(12, 3, "touch")).toBe("scrub");
    expect(resolveTouchIntent(3, 3, "touch")).toBe("pending");
  });

  it("locks mouse drags past 3px", () => {
    expect(resolveTouchIntent(2, 0, "mouse")).toBe("pending");
    expect(resolveTouchIntent(5, 0, "mouse")).toBe("scrub");
  });
});
