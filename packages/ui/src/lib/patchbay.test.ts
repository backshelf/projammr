import { describe, expect, it } from "bun:test";
import {
  type PatchCable,
  type PatchNode,
  type PatchbayLayout,
  layoutPatchbay,
} from "./patchbay";

const node = (id: string, label = id, over: Partial<PatchNode> = {}) => ({
  id,
  label,
  ...over,
});

const cable = (left: string, right: string, missing?: boolean): PatchCable =>
  missing === undefined ? { left, right } : { left, right, missing };

const ids = (nodes: PatchNode[]) => nodes.map((n) => n.id);

/** Every pair of cables that cross between the rails. */
function crossings(layout: PatchbayLayout): number {
  let count = 0;
  for (const a of layout.cables) {
    for (const b of layout.cables) {
      if (a.left < b.left && a.right > b.right) count++;
    }
  }
  return count;
}

// Two groups of sets, each sharing one sample, with labels that interleave the
// groups. By label alone the rails read Anthem, Ballad, Coda, Dirge against
// mid, zap, and every cable crosses its neighbour. The barycentres put zap
// (rows 0 and 2) above mid (1 and 3), and the sweep gathers each group beside
// its sample: Anthem, Coda → zap; Ballad, Dirge → mid, with no crossing.
const groups = {
  left: [
    node("d", "Dirge"),
    node("b", "Ballad"),
    node("a", "Anthem"),
    node("c", "Coda"),
  ],
  right: [node("m", "mid.wav"), node("s", "solo.wav"), node("z", "zap.wav")],
  cables: [
    cable("a", "z"),
    cable("c", "z"),
    cable("b", "m"),
    cable("d", "m"),
    cable("d", "s"),
  ],
};

describe("layoutPatchbay", () => {
  it("folds a right node only one left node uses into that node's own count", () => {
    const layout = layoutPatchbay(
      [node("a"), node("b")],
      [node("x"), node("p"), node("q"), node("r")],
      [
        cable("a", "x"),
        cable("b", "x"),
        cable("a", "p"),
        cable("a", "q"),
        cable("b", "r"),
      ]
    );

    expect(ids(layout.right)).toEqual(["x"]);
    expect(layout.own).toEqual(
      new Map([
        ["a", 2],
        ["b", 1],
      ])
    );
    expect(layout.cables).toEqual([
      { left: 0, right: 0, missing: false },
      { left: 1, right: 0, missing: false },
    ]);
  });

  it("orders the right rail by its neighbours' mean row, then gathers each left group beside it", () => {
    const layout = layoutPatchbay(groups.left, groups.right, groups.cables);

    expect(ids(layout.right)).toEqual(["z", "m"]);
    expect(ids(layout.left)).toEqual(["a", "c", "b", "d"]);
    expect(layout.own).toEqual(new Map([["d", 1]]));
    expect(crossings(layout)).toBe(0);
  });

  it("sweeps the left rail once more against the right rail's order", () => {
    // By cable count the left rail reads Alpha, Bravo, Charlie, and Alpha → x
    // crosses Bravo → y; the sweep lifts Bravo above Alpha.
    const layout = layoutPatchbay(
      [node("A", "Alpha"), node("B", "Bravo"), node("C", "Charlie")],
      [node("X", "x.wav"), node("Y", "y.wav")],
      [cable("A", "X"), cable("A", "Y"), cable("B", "Y"), cable("C", "X")]
    );

    expect(ids(layout.left)).toEqual(["B", "A", "C"]);
    expect(ids(layout.right)).toEqual(["Y", "X"]);
    expect(crossings(layout)).toBe(0);
  });

  it("orders nodes with no cables by label, after the patched ones", () => {
    const layout = layoutPatchbay(
      [node("q", "Quiet"), node("a", "Anthem"), node("b", "Ballad")],
      [node("n2", "set 10.wav"), node("n1", "set 2.wav"), node("x", "x.wav")],
      [cable("b", "x"), cable("a", "x")]
    );

    expect(ids(layout.left)).toEqual(["a", "b", "q"]);
    expect(ids(layout.right)).toEqual(["x", "n1", "n2"]);
  });

  it("cuts each rail after ordering, dropping cables to a cut row and counting what was cut", () => {
    const layout = layoutPatchbay(groups.left, groups.right, groups.cables, {
      maxLeft: 3,
      maxRight: 1,
    });

    expect(ids(layout.left)).toEqual(["a", "c", "b"]);
    expect(ids(layout.right)).toEqual(["z"]);
    expect(layout.moreLeft).toBe(1);
    expect(layout.moreRight).toBe(1);
    expect(layout.cables).toEqual([
      { left: 0, right: 0, missing: false },
      { left: 1, right: 0, missing: false },
    ]);
    // Dirge, the only set with a sample of its own, was cut.
    expect(layout.own.size).toBe(0);
  });

  it("gives the same layout whatever order the nodes and cables arrive in", () => {
    const first = layoutPatchbay(groups.left, groups.right, groups.cables);
    const shuffled = layoutPatchbay(
      [...groups.left].reverse(),
      [...groups.right].reverse(),
      [...groups.cables].reverse()
    );

    expect(shuffled).toEqual(first);
    expect(layoutPatchbay(groups.left, groups.right, groups.cables)).toEqual(
      first
    );
  });

  it("dashes the cables of a missing node and merges a repeated cable", () => {
    const layout = layoutPatchbay(
      [node("a"), node("b")],
      [node("gone", "gone.wav", { missing: true }), node("x")],
      [
        cable("a", "gone"),
        cable("b", "gone"),
        cable("a", "x"),
        cable("b", "x", true),
        cable("b", "x"),
      ]
    );

    const byPair = (l: string, r: string) =>
      layout.cables.find(
        (c) => layout.left[c.left]?.id === l && layout.right[c.right]?.id === r
      );
    expect(layout.cables).toHaveLength(4);
    expect(byPair("a", "gone")?.missing).toBe(true);
    expect(byPair("b", "gone")?.missing).toBe(true);
    expect(byPair("a", "x")?.missing).toBe(false);
    expect(byPair("b", "x")?.missing).toBe(true);
  });

  it("draws both rails with no cables when nothing is patched", () => {
    const layout = layoutPatchbay([node("a"), node("b")], [node("x")], []);

    expect(ids(layout.left)).toEqual(["a", "b"]);
    expect(ids(layout.right)).toEqual(["x"]);
    expect(layout.cables).toEqual([]);
    expect(layout.own.size).toBe(0);
  });

  it("drops a cable naming an unknown node without throwing", () => {
    const layout = layoutPatchbay(
      [node("a"), node("b")],
      [node("x")],
      [
        cable("a", "x"),
        cable("b", "x"),
        cable("ghost", "x"),
        cable("a", "nope"),
      ]
    );

    expect(layout.cables).toHaveLength(2);
    expect(ids(layout.right)).toEqual(["x"]);
  });

  it("empties the right rail when every right node is single-use", () => {
    const layout = layoutPatchbay(
      [node("a"), node("b")],
      [node("p"), node("q"), node("r")],
      [cable("a", "p"), cable("a", "q"), cable("b", "r")]
    );

    expect(layout.right).toEqual([]);
    expect(layout.cables).toEqual([]);
    expect(layout.own).toEqual(
      new Map([
        ["a", 2],
        ["b", 1],
      ])
    );
  });
});
