import { describe, expect, it } from "bun:test";

import {
  bindsScroll,
  MASTHEAD_SCROLL,
  MASTHEAD_SCROLL_PHONE,
  mastheadScroll,
  scrolled,
  type MastheadPart,
  type MastheadRecession,
} from "./masthead-scroll";

const PARTS = Object.keys(MASTHEAD_SCROLL) as MastheadPart[];

const travels = (recession: MastheadRecession) =>
  [recession.opacity, recession.scale, recession.y].filter((pair) => !!pair);

describe("scrolled", () => {
  it("holds the resting value before the canvas has moved", () => {
    expect(scrolled(0, 560, [1, 0.35])).toBe(1);
  });

  it("holds the resting value when the offset is negative", () => {
    expect(scrolled(-200, 560, [1, 0.35])).toBe(1);
  });

  it("holds the receded value past the end of the range", () => {
    expect(scrolled(5000, 560, [1, 0.35])).toBe(0.35);
  });

  it("interpolates linearly between the two ends", () => {
    expect(scrolled(280, 560, [1, 0.35])).toBeCloseTo(0.675, 10);
    expect(scrolled(140, 560, [0, -48])).toBeCloseTo(-12, 10);
  });
});

describe("bindsScroll", () => {
  it("leaves an arriving page's entrance alone at the top", () => {
    expect(bindsScroll(false, 0)).toBe(false);
  });

  it("binds a restored page from its first frame", () => {
    expect(bindsScroll(false, 480)).toBe(true);
  });

  it("binds once the entrance has settled", () => {
    expect(bindsScroll(true, 0)).toBe(true);
  });
});

describe("the masthead recession tables", () => {
  it("recedes every part sooner on a phone than on the desktop", () => {
    for (const part of PARTS) {
      expect(MASTHEAD_SCROLL_PHONE[part].end).toBeLessThan(
        MASTHEAD_SCROLL[part].end
      );
    }
  });

  it("starts every part at rest at a resting scroll offset", () => {
    for (const phone of [false, true]) {
      for (const part of PARTS) {
        const recession = mastheadScroll(phone)[part];
        for (const pair of travels(recession)) {
          expect(scrolled(0, recession.end, pair)).toBe(pair[0]);
        }
      }
    }
  });

  it("leaves the art visible and the head gone at the end of the range", () => {
    for (const phone of [false, true]) {
      const { art, head } = mastheadScroll(phone);
      expect(scrolled(art.end, art.end, art.opacity)).toBe(0.35);
      expect(scrolled(head.end, head.end, head.opacity)).toBe(0);
    }
  });

  it("picks the phone table only at phone width", () => {
    expect(mastheadScroll(true)).toBe(MASTHEAD_SCROLL_PHONE);
    expect(mastheadScroll(false)).toBe(MASTHEAD_SCROLL);
  });
});
