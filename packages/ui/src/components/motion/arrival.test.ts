import { describe, expect, it } from "bun:test";
import {
  ARRIVAL,
  arrivalKind,
  arrivalVariants,
  type ArrivalPart,
} from "./arrival";

/** The parts in the order the entrance brings them forward. */
const ORDER: ArrivalPart[] = [
  "art",
  "wash",
  "crumbs",
  "eyebrow",
  "title",
  "byline",
  "audio",
];

const PARTS = Object.keys(ARRIVAL) as ArrivalPart[];

/** The animated properties of a variant — everything but its transition. */
const animated = (variant: unknown) =>
  Object.keys(variant as object)
    .filter((key) => key !== "transition")
    .sort();

describe("arrivalKind", () => {
  it("calls a mount that happened before hydration a first load", () => {
    expect(arrivalKind(false)).toBe("load");
  });

  it("calls a mount that happened after hydration a navigation", () => {
    expect(arrivalKind(true)).toBe("nav");
  });
});

describe("ARRIVAL", () => {
  it("staggers the parts in the order they come forward", () => {
    const delays = ORDER.map((part) => ARRIVAL[part].delay);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
  });

  it("fades the rail alongside the type rather than after it", () => {
    expect(ARRIVAL.rail.delay).toBeGreaterThan(ARRIVAL.crumbs.delay);
    expect(ARRIVAL.rail.delay).toBeLessThan(ARRIVAL.audio.delay);
  });

  it("keeps the art blooming until every part has arrived", () => {
    const last = Math.max(
      ...ORDER.map((part) => ARRIVAL[part].delay + ARRIVAL[part].dur)
    );
    expect(ARRIVAL.art.delay + ARRIVAL.art.dur).toBe(last);
  });
});

describe("arrivalVariants", () => {
  it("gives every part on a first load both a hidden and a shown state", () => {
    for (const part of PARTS) {
      const variants = arrivalVariants("load", part);
      expect(animated(variants.hidden)).toContain("opacity");
      expect(animated(variants.shown)).toContain("opacity");
    }
  });

  it("plays each part's own stagger on a first load", () => {
    for (const part of PARTS) {
      const { shown } = arrivalVariants("load", part);
      expect(shown).toMatchObject({
        transition: { delay: ARRIVAL[part].delay, duration: ARRIVAL[part].dur },
      });
    }
  });

  it("moves nothing but opacity on a navigation", () => {
    for (const part of PARTS) {
      const { hidden, shown } = arrivalVariants("nav", part);
      const moved = animated(shown).filter(
        (key) =>
          (shown as Record<string, unknown>)[key] !==
          (hidden as Record<string, unknown>)[key]
      );
      expect(moved).toEqual(["opacity"]);
    }
  });

  it("holds the resting scale and offset through a navigation crossfade", () => {
    expect(arrivalVariants("nav", "art")).toMatchObject({
      hidden: { scale: 1.15 },
      shown: { scale: 1.15 },
    });
    expect(arrivalVariants("nav", "title")).toMatchObject({
      hidden: { y: 0 },
      shown: { y: 0 },
    });
  });
});
