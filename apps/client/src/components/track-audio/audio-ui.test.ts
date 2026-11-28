import {
  isAllResolved,
  versionCommentsLabel,
} from "@/components/track-audio/audio-ui";
import { describe, expect, it } from "bun:test";

describe("versionCommentsLabel", () => {
  it("names the version when it has no comments", () => {
    expect(versionCommentsLabel(0, 2)).toBe("Comments on v2");
  });

  it("counts the comments on the version", () => {
    expect(versionCommentsLabel(1, 2)).toBe("1 comment on v2");
    expect(versionCommentsLabel(3, 2)).toBe("3 comments on v2");
  });

  it("adds the resolved count when some are resolved", () => {
    expect(versionCommentsLabel(3, 2, 1)).toBe("3 comments on v2 · 1 resolved");
  });

  it("reads resolved cleanly for single and multiple resolved comments", () => {
    expect(versionCommentsLabel(3, 2, 3)).toBe("All 3 resolved on v2");
    expect(versionCommentsLabel(1, 2, 1)).toBe("1 resolved on v2");
  });
});

describe("isAllResolved", () => {
  it("needs at least one comment and none open", () => {
    expect(isAllResolved(0, 0)).toBe(false);
    expect(isAllResolved(2, 1)).toBe(false);
    expect(isAllResolved(2, 2)).toBe(true);
  });
});
