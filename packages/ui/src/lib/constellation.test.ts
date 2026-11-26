import { describe, expect, it } from "bun:test";
import {
  adjacencyOf,
  fitOf,
  litOf,
  matchesOf,
  type ConstellationData,
  type ConstellationNode,
} from "./constellation";

const node = (
  id: string,
  shape: ConstellationNode["shape"],
  extra: Partial<ConstellationNode> = {}
): ConstellationNode => ({
  id,
  label: id,
  count: "",
  shape,
  x: 0,
  y: 0,
  size: 3,
  ...extra,
});

// Two sets sharing one device; the second set also carries a second device.
const DATA: ConstellationData = {
  nodes: [
    node("set:a", "circle", { label: "Invented Set A" }),
    node("set:b", "circle", { label: "Invented Set B", meta: "Harbour" }),
    node("item:verb", "square", { label: "Glasshall Verb", meta: "Nimbus" }),
    node("item:comp", "square", { label: "Compressor", meta: "Built-in" }),
  ],
  edges: [
    [0, 2, 0.5, 1],
    [1, 2, 0.5, 2],
    [1, 3, 1, 1],
  ],
  key: "k",
};

describe("adjacencyOf", () => {
  it("lists each node's neighbours and the edges that reach them", () => {
    const adjacency = adjacencyOf(DATA);
    expect(adjacency.neighbours).toEqual([[2], [2, 3], [0, 1], [1]]);
    expect(adjacency.edges).toEqual([[0], [1, 2], [0, 1], [2]]);
  });
});

describe("matchesOf", () => {
  it("matches a label or a meta line, whatever its case", () => {
    expect(matchesOf(DATA.nodes, "VERB")).toEqual([2]);
    expect(matchesOf(DATA.nodes, "harbour")).toEqual([1]);
    expect(matchesOf(DATA.nodes, "invented set")).toEqual([0, 1]);
  });

  it("matches nothing for a blank search", () => {
    expect(matchesOf(DATA.nodes, "")).toEqual([]);
    expect(matchesOf(DATA.nodes, "   ")).toEqual([]);
  });
});

describe("litOf", () => {
  const adjacency = adjacencyOf(DATA);

  it("lights a held node, its edges and its neighbours", () => {
    const lit = litOf(adjacency, 1, []);
    expect(lit?.held).toBe(1);
    expect([...(lit?.nodes ?? [])].sort()).toEqual([1, 2, 3]);
    expect([...(lit?.edges ?? [])].sort()).toEqual([1, 2]);
  });

  it("lets a held node outrank the search's matches", () => {
    expect([...(litOf(adjacency, 0, [3])?.nodes ?? [])].sort()).toEqual([0, 2]);
  });

  it("lights the matches alone, with no edges, when nothing is held", () => {
    const lit = litOf(adjacency, null, [3]);
    expect(lit?.held).toBeNull();
    expect([...(lit?.nodes ?? [])]).toEqual([3]);
    expect(lit?.edges.size).toBe(0);
  });

  it("lights nothing, and so dims nothing, with neither", () => {
    expect(litOf(adjacency, null, [])).toBeNull();
  });
});

describe("fitOf", () => {
  it("centres on the points' box and zooms so it fills three quarters of the view", () => {
    const fit = fitOf(
      [
        { x: 0.2, y: 0.4 },
        { x: 0.5, y: 0.5 },
      ],
      0.05
    );
    expect(fit.x).toBeCloseTo(0.35);
    expect(fit.y).toBeCloseTo(0.45);
    expect(fit.ratio).toBeCloseTo(0.4);
  });

  it("never zooms closer than the floor, nor further out than the whole drawing", () => {
    expect(fitOf([{ x: 0.3, y: 0.3 }], 0.2).ratio).toBe(0.2);
    expect(
      fitOf(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        0.2
      ).ratio
    ).toBe(1);
  });

  it("frames the whole drawing when there is nothing to frame", () => {
    expect(fitOf([], 0.2)).toEqual({ x: 0.5, y: 0.5, ratio: 1 });
  });
});
