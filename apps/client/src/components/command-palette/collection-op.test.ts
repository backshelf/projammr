import { describe, expect, it } from "bun:test";

import { matchCollectionOpPrefix, planCollectionOp } from "./collection-op";

describe("matchCollectionOpPrefix", () => {
  it("recognises add anywhere", () => {
    expect(matchCollectionOpPrefix("add low tide", { canMove: false })).toEqual(
      { verb: "add", remainder: "low tide" }
    );
  });

  it("only offers move when the page is scoped to a collection", () => {
    expect(matchCollectionOpPrefix("move low tide", { canMove: false })).toBe(
      null
    );
    expect(matchCollectionOpPrefix("move low tide", { canMove: true })).toEqual(
      { verb: "move", remainder: "low tide" }
    );
  });
});

describe("planCollectionOp", () => {
  it("adds straight to the target", () => {
    expect(
      planCollectionOp({ verb: "add", trackId: 7, trackTitle: "t" }, 3)
    ).toEqual([{ kind: "add", collectionId: 3, trackId: 7 }]);
  });

  it("moves out of the source collection, never the target", () => {
    expect(
      planCollectionOp(
        { verb: "move", trackId: 7, trackTitle: "t", fromCollectionId: 2 },
        3
      )
    ).toEqual([
      { kind: "remove", collectionId: 2, trackId: 7 },
      { kind: "add", collectionId: 3, trackId: 7 },
    ]);
  });

  it("does nothing when moving into the collection the track is already in", () => {
    expect(
      planCollectionOp(
        { verb: "move", trackId: 7, trackTitle: "t", fromCollectionId: 3 },
        3
      )
    ).toBe(null);
  });

  it("refuses a move with no source", () => {
    expect(
      planCollectionOp({ verb: "move", trackId: 7, trackTitle: "t" }, 3)
    ).toBe(null);
  });
});
