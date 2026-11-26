import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { clearDraft, DRAFTS_KEY, loadDraft, saveDraft } from "./draft";
import type { Composer } from "./suggestion";

const typedBox: Composer = { text: "tightened", edited: true, dropped: [] };
const droppedBox: Composer = {
  text: "+1 track",
  edited: false,
  dropped: ["+EQ Eight on Bass"],
};

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("the commit drafts", () => {
  test("a draft is kept for its set and read back", () => {
    saveDraft("/a/one.als", typedBox);
    saveDraft("/a/two.als", droppedBox);

    expect(loadDraft("/a/one.als")).toEqual(typedBox);
    expect(loadDraft("/a/two.als")).toEqual(droppedBox);
    expect(loadDraft("/a/three.als")).toBeNull();
  });

  test("a box that holds only the suggestion is no draft", () => {
    saveDraft("/a/one.als", typedBox);
    saveDraft("/a/one.als", { text: "+1 track", edited: false, dropped: [] });

    expect(loadDraft("/a/one.als")).toBeNull();
  });

  test("clearing one set leaves the others", () => {
    saveDraft("/a/one.als", typedBox);
    saveDraft("/a/two.als", typedBox);
    clearDraft("/a/one.als");

    expect(loadDraft("/a/one.als")).toBeNull();
    expect(loadDraft("/a/two.als")).toEqual(typedBox);
  });

  test("lives under a versioned key", () => {
    saveDraft("/a/one.als", typedBox);

    expect(DRAFTS_KEY).toBe("dit-app:commit-drafts:v1");
    expect(localStorage.getItem(DRAFTS_KEY)).not.toBeNull();
  });

  test.each([
    ["not JSON", "{"],
    ["not an object", "[1]"],
    ["a null", "null"],
  ])("a stored value that is %s reads as no draft", (_, stored) => {
    localStorage.setItem(DRAFTS_KEY, stored);

    expect(loadDraft("/a/one.als")).toBeNull();
  });

  test("an entry of a shape this code does not know is skipped, the others kept", () => {
    localStorage.setItem(
      DRAFTS_KEY,
      JSON.stringify({
        "/a/one.als": { text: 4 },
        "/a/two.als": typedBox,
      })
    );

    expect(loadDraft("/a/one.als")).toBeNull();
    expect(loadDraft("/a/two.als")).toEqual(typedBox);
  });
});
