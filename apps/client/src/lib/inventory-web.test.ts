import { describe, expect, it, mock } from "bun:test";
import type { PatchNode } from "@workspace/ui/lib/patchbay";
import {
  STOCK_MIN_SETS,
  inventoryWeb,
  rarityOf,
  thicknessOf,
  type WebCable,
} from "./inventory-web";

const set = (id: string): PatchNode => ({
  id,
  label: `Invented Set ${id}`,
  href: `/project/7/session/${id}`,
});
const item = (id: string, extra: Partial<PatchNode> = {}): PatchNode => ({
  id,
  label: id,
  href: `/project/7/plugins?device=${id}`,
  ...extra,
});
const uses = (setId: string, itemId: string, count?: number): WebCable => ({
  left: setId,
  right: itemId,
  ...(count === undefined ? {} : { uses: count }),
});

const PLUGINS = { minShared: 1, stock: false, item: "device" };
const SAMPLES = { minShared: 2, stock: false, item: "sample" };

/** Twenty sets: every one carries Echo, every even one Glue, and each pair of
 *  neighbours shares a rare device of its own. */
function library(): {
  left: PatchNode[];
  right: PatchNode[];
  cables: WebCable[];
} {
  const sets = Array.from({ length: 20 }, (_, i) => set(String(i + 1)));
  const rare = Array.from({ length: 10 }, (_, i) => item(`Rare ${i + 1}`));
  const cables: WebCable[] = sets.flatMap((s, i) => [
    uses(s.id, "Echo", 3),
    ...(i % 2 === 0 ? [uses(s.id, "Glue")] : []),
    uses(s.id, `Rare ${Math.floor(i / 2) + 1}`),
  ]);
  return {
    left: sets,
    right: [item("Echo"), item("Glue"), ...rare],
    cables,
  };
}

describe("inventoryWeb", () => {
  it("draws sets as circles that open their set and items as squares that show their row", async () => {
    const { web } = await inventoryWeb(
      {
        left: [set("1"), set("2")],
        right: [item("Verb", { meta: "Nimbus Audio · VST3" }), item("Comp")],
        cables: [uses("1", "Verb", 1), uses("2", "Verb", 4), uses("1", "Comp")],
      },
      PLUGINS
    );

    const byId = new Map(web.nodes.map((node) => [node.id, node]));
    expect(byId.get("set:1")).toMatchObject({
      shape: "circle",
      label: "Invented Set 1",
      count: "2 devices",
      link: { label: "Open set", href: "/project/7/session/1" },
    });
    expect(byId.get("item:Verb")).toMatchObject({
      shape: "square",
      meta: "Nimbus Audio · VST3",
      count: "in 2 sets",
      link: { label: "Show row", href: "/project/7/plugins?device=Verb" },
    });
    expect(byId.get("item:Comp")?.count).toBe("in 1 set");
    expect(web.edges).toHaveLength(3);
  });

  it("weighs an edge by its item's rarity and thickens it with the set's uses", async () => {
    const { web } = await inventoryWeb(
      {
        left: [set("1"), set("2")],
        right: [item("Verb")],
        cables: [uses("1", "Verb", 1), uses("2", "Verb", 4)],
      },
      PLUGINS
    );

    const index = (id: string) => web.nodes.findIndex((node) => node.id === id);
    const edge = (setId: string) =>
      web.edges.find(([source]) => source === index(`set:${setId}`));
    expect(edge("1")).toEqual([
      index("set:1"),
      index("item:Verb"),
      Math.round(rarityOf(2) * 1000) / 1000,
      1,
    ]);
    expect(edge("2")?.[3]).toBe(3);
  });

  it("folds items fewer sets than minShared use into their sets' own count", async () => {
    const { web, stock } = await inventoryWeb(
      {
        left: [set("1"), set("2"), set("3")],
        right: [item("shared.wav"), item("mine.wav"), item("also-mine.wav")],
        cables: [
          uses("1", "shared.wav"),
          uses("2", "shared.wav"),
          uses("1", "mine.wav"),
          uses("1", "also-mine.wav"),
          uses("3", "also-mine.wav"),
        ],
      },
      { ...SAMPLES, minShared: 3 }
    );

    // Nothing reaches three sets: every sample folds, and with no edge left
    // no set is drawn either.
    expect(web.nodes).toEqual([]);
    expect(stock).toEqual([]);

    const shared = await inventoryWeb(
      {
        left: [set("1"), set("2"), set("3")],
        right: [item("shared.wav"), item("mine.wav"), item("solo.wav")],
        cables: [
          uses("1", "shared.wav"),
          uses("2", "shared.wav"),
          uses("1", "mine.wav"),
          // Set 3 uses only a sample of its own, so it has nothing to draw.
          uses("3", "solo.wav"),
        ],
      },
      SAMPLES
    );
    expect(shared.web.nodes.map((node) => node.id).sort()).toEqual([
      "item:shared.wav",
      "set:1",
      "set:2",
    ]);
    expect(shared.web.nodes.find((node) => node.id === "set:1")?.count).toBe(
      "1 sample · +1 own"
    );
  });

  it("parks the stock chain under the web, most used first, and draws it on request", async () => {
    const { web, stock } = await inventoryWeb(library(), PLUGINS);

    // Echo is in all twenty sets and Glue in ten: both over 40%.
    expect(stock.map((entry) => [entry.label, entry.sets])).toEqual([
      ["Echo", 20],
      ["Glue", 10],
    ]);
    expect(stock[0]?.href).toBe("/project/7/plugins?device=Echo");
    expect(web.nodes.some((node) => node.id === "item:Echo")).toBe(false);
    expect(web.nodes.filter((node) => node.shape === "circle")).toHaveLength(
      20
    );
    expect(web.edges).toHaveLength(20);

    const drawn = await inventoryWeb(library(), { ...PLUGINS, stock: true });
    expect(drawn.stock).toEqual(stock);
    expect(drawn.web.nodes.some((node) => node.id === "item:Echo")).toBe(true);
    expect(drawn.web.edges).toHaveLength(50);
  });

  it(`parks nothing a page's handful of sets share, below ${STOCK_MIN_SETS} sets`, async () => {
    const { web, stock } = await inventoryWeb(
      {
        left: [set("1"), set("2"), set("3")],
        right: [item("Echo")],
        cables: [uses("1", "Echo"), uses("2", "Echo"), uses("3", "Echo")],
      },
      PLUGINS
    );

    expect(stock).toEqual([]);
    expect(web.nodes).toHaveLength(4);
  });

  it("drops a set whose every item is parked", async () => {
    const input = library();
    input.left.push(set("stock-only"));
    input.cables.push(uses("stock-only", "Echo"));

    const { web } = await inventoryWeb(input, PLUGINS);
    expect(web.nodes.some((node) => node.id === "set:stock-only")).toBe(false);
  });

  it("marks a missing item to be drawn in the warning colour", async () => {
    const { web } = await inventoryWeb(
      {
        left: [set("1"), set("2")],
        right: [item("lost.wav", { missing: true }), item("found.wav")],
        cables: [
          uses("1", "lost.wav"),
          uses("2", "lost.wav"),
          uses("1", "found.wav"),
          uses("2", "found.wav"),
        ],
      },
      SAMPLES
    );

    expect(web.nodes.find((node) => node.id === "item:lost.wav")?.warn).toBe(
      true
    );
    expect(
      web.nodes.find((node) => node.id === "item:found.wav")?.warn
    ).toBeUndefined();
  });

  it("drops a cable naming an unknown id, and merges repeats by adding their uses", async () => {
    const { web } = await inventoryWeb(
      {
        left: [set("1")],
        right: [item("Verb")],
        cables: [uses("1", "Verb", 1), uses("1", "Verb", 1), uses("9", "Verb")],
      },
      PLUGINS
    );

    expect(web.edges).toEqual([[0, 1, 1, 2]]);
  });

  it("lays the same input out the same way every time, and keys the drawing by what it draws", async () => {
    const first = await inventoryWeb(library(), PLUGINS);
    const second = await inventoryWeb(library(), PLUGINS);
    expect(second.web).toEqual(first.web);

    const other = library();
    other.cables.pop();
    expect((await inventoryWeb(other, PLUGINS)).web.key).not.toBe(
      first.web.key
    );
  });

  it("spreads the marks so none overlaps another", async () => {
    const { web } = await inventoryWeb(library(), { ...PLUGINS, stock: true });

    for (const [i, a] of web.nodes.entries()) {
      for (const b of web.nodes.slice(i + 1)) {
        const gap = Math.hypot(a.x - b.x, a.y - b.y);
        expect(gap).toBeGreaterThanOrEqual(a.size + b.size);
      }
    }
  });

  it("hands the event loop back between passes of the layout", async () => {
    const pause = mock(() => Promise.resolve());
    await inventoryWeb(library(), { ...PLUGINS, pause });
    expect(pause.mock.calls.length).toBeGreaterThan(1);
  });

  it("has nothing to draw for nothing", async () => {
    expect(
      await inventoryWeb({ left: [], right: [], cables: [] }, PLUGINS)
    ).toEqual({
      web: { nodes: [], edges: [], key: expect.any(String) },
      stock: [],
    });
  });
});

describe("rarityOf and thicknessOf", () => {
  it("weighs a one-set item at 1 and a 190-set item at about 0.13", () => {
    expect(rarityOf(1)).toBe(1);
    expect(rarityOf(190)).toBeCloseTo(0.132, 3);
  });

  it("draws one to three pixels by uses, and one where uses are unknown", () => {
    expect(thicknessOf(undefined)).toBe(1);
    expect(thicknessOf(1)).toBe(1);
    expect(thicknessOf(2)).toBe(2);
    expect(thicknessOf(64)).toBe(3);
  });
});
