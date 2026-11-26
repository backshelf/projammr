import {
  CLOSED,
  coverArrived,
  opened,
  OPENED_FROM_COVER,
} from "@/components/music-player/now-playing-state";
import { describe, expect, it } from "bun:test";

describe("the now-playing view's state", () => {
  it("holds the cover in the sheet from the first frame when it was not opened from one", () => {
    expect(opened(CLOSED)).toEqual({
      open: true,
      fromCover: false,
      coverInSheet: true,
    });
  });

  it("leaves the cover on the dock while the sheet opens from it", () => {
    expect(OPENED_FROM_COVER).toEqual({
      open: true,
      fromCover: true,
      coverInSheet: false,
    });
  });

  it("hands the cover to the sheet once the sheet has one of its own", () => {
    expect(coverArrived(OPENED_FROM_COVER)).toEqual({
      open: true,
      fromCover: true,
      coverInSheet: true,
    });
  });

  it("puts the cover back on the dock and forgets the morph when the view closes", () => {
    expect(CLOSED).toEqual({
      open: false,
      fromCover: false,
      coverInSheet: false,
    });
  });
});
