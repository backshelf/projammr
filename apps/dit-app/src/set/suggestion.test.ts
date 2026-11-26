import { describe, expect, test } from "bun:test";

import type { Clause } from "../ipc";
import {
  following,
  isOn,
  toggled,
  typed,
  untouched,
  written,
  type Composer,
} from "./suggestion";

const tracks: Clause = { kind: "tracks", text: "+1 track" };
const eq: Clause = { kind: "devices", text: "+EQ Eight on Bass" };
const tempo: Clause = { kind: "tempo", text: "tempo 120 \u2192 124" };
const clauses = [tracks, eq, tempo];

/** The box after a run of clicks on `clicks`, each on a box that follows the suggestion. */
function afterClicks(...clicks: Clause[]): Composer {
  return clicks.reduce(
    (box, clause) => toggled(following(box, clauses), clauses, clause),
    untouched(clauses)
  );
}

describe("the commit box's clauses", () => {
  test("opens on the whole suggestion, every chip on", () => {
    const box = untouched(clauses);

    expect(box.text).toBe("+1 track, +EQ Eight on Bass, tempo 120 \u2192 124");
    expect(clauses.map((clause) => isOn(box, clause))).toEqual([
      true,
      true,
      true,
    ]);
  });

  test.each([
    ["the first", [tracks], "+EQ Eight on Bass, tempo 120 \u2192 124"],
    ["a middle one", [eq], "+1 track, tempo 120 \u2192 124"],
    ["the last", [tempo], "+1 track, +EQ Eight on Bass"],
    ["two", [tracks, tempo], "+EQ Eight on Bass"],
    ["all", [tracks, eq, tempo], ""],
    [
      "one and back on",
      [eq, eq],
      "+1 track, +EQ Eight on Bass, tempo 120 \u2192 124",
    ],
  ])("a clause toggled off drops from the message: %s", (_, clicks, text) => {
    expect(afterClicks(...clicks).text).toBe(text);
  });

  test("a dropped clause's chip shows off and the others stay on", () => {
    const box = afterClicks(eq);

    expect(clauses.map((clause) => isOn(box, clause))).toEqual([
      true,
      false,
      true,
    ]);
  });

  describe("after the person has typed", () => {
    test("a chip is on while the text holds its words", () => {
      const box = typed(untouched(clauses), "tightened the kick, +1 track");

      expect(clauses.map((clause) => isOn(box, clause))).toEqual([
        true,
        false,
        false,
      ]);
    });

    test("a click takes its words out of the text, with the comma that joined them", () => {
      const middle = typed(untouched(clauses), "a, +EQ Eight on Bass, b");
      const last = typed(untouched(clauses), "a, +EQ Eight on Bass");
      const first = typed(untouched(clauses), "+EQ Eight on Bass, b");
      const only = typed(untouched(clauses), "+EQ Eight on Bass");

      expect(toggled(middle, clauses, eq).text).toBe("a, b");
      expect(toggled(last, clauses, eq).text).toBe("a");
      expect(toggled(first, clauses, eq).text).toBe("b");
      expect(toggled(only, clauses, eq).text).toBe("");
    });

    test("a dropped clause comes back at the end of what they wrote", () => {
      const dropped = afterClicks(eq);
      const edited = typed(dropped, "kick tightened");

      expect(isOn(edited, eq)).toBe(false);
      expect(toggled(edited, clauses, eq).text).toBe(
        "kick tightened, +EQ Eight on Bass"
      );
    });

    test("a clause added to an empty text is the whole text", () => {
      expect(toggled(typed(untouched(clauses), ""), clauses, tempo).text).toBe(
        "tempo 120 \u2192 124"
      );
    });

    test("typed text is the person's own: a new suggestion does not replace it", () => {
      const edited = typed(untouched(clauses), "my own words");
      const next = [{ kind: "scenes" as const, text: "+2 scenes" }];

      expect(following(edited, next)).toBe(edited);
      expect(following(edited, next).text).toBe("my own words");
    });

    test("clearing the box leaves it empty and every chip off", () => {
      const cleared = typed(untouched(clauses), "");

      expect(cleared.text).toBe("");
      expect(clauses.some((clause) => isOn(cleared, clause))).toBe(false);
    });
  });

  describe("while the person has not typed", () => {
    test("the text follows the suggestion as saves change it", () => {
      const next = [tracks, { kind: "scenes" as const, text: "+2 scenes" }];

      expect(following(untouched(clauses), next).text).toBe(
        "+1 track, +2 scenes"
      );
    });

    test("a clause that was dropped and is gone from the suggestion is forgotten, so a return of its words starts on", () => {
      const dropped = afterClicks(eq);
      const gone = following(dropped, [tracks, tempo]);
      const back = following(gone, clauses);

      expect(gone.dropped).toEqual([]);
      expect(back.text).toBe(
        "+1 track, +EQ Eight on Bass, tempo 120 \u2192 124"
      );
    });

    test("a dropped clause stays dropped while the suggestion still has it", () => {
      const dropped = afterClicks(eq);

      expect(following(dropped, [eq, tempo, tracks]).text).toBe(
        "tempo 120 \u2192 124, +1 track"
      );
    });

    test("returns the same box when nothing moved", () => {
      const box = untouched(clauses);

      expect(following(box, clauses)).toBe(box);
    });
  });

  test("a box opened on written text is the person's and keeps it", () => {
    const box = written("half a thought");

    expect(box.edited).toBe(true);
    expect(following(box, clauses)).toBe(box);
  });
});
