import { describe, expect, it } from "bun:test";
import { CHAIN_CEILING, skylineOf } from "./skyline.js";
import type { DeviceRow, TrackRow } from "./structure.js";
import { lastIndexOf, rowTree, subtreeChanged, subtreeSize } from "./tree.js";

const chain = (
  length: number,
  status: DeviceRow["status"] = "same"
): DeviceRow[] =>
  Array.from({ length }, (_, i) => ({
    name: `Device ${i}`,
    status,
    origin: "builtin" as const,
  }));

const row = (name: string, over: Partial<TrackRow> = {}): TrackRow => ({
  key: name,
  kind: "audio",
  name,
  status: "same",
  devices: [],
  ...over,
});

/** DRUMS holding Kick and PERC, PERC holding Shaker, then a lead and a return. */
const SET: TrackRow[] = [
  row("DRUMS", { kind: "group", id: 1, color: "#ff3636" }),
  row("Kick", { id: 2, groupId: 1 }),
  row("PERC", { kind: "group", id: 3, groupId: 1, color: "#5480e4" }),
  row("Shaker", { id: 4, groupId: 3, status: "added" }),
  row("Lead", { id: 5 }),
  row("A Reverb", { kind: "return", id: 6 }),
];

describe("rowTree", () => {
  it("nests rows under the group their groupId names", () => {
    const [drums, lead, reverb] = rowTree(SET);

    expect(drums!.children.map((child) => child.row.name)).toEqual([
      "Kick",
      "PERC",
    ]);
    expect(drums!.children[1]!.children.map((c) => c.row.name)).toEqual([
      "Shaker",
    ]);
    expect([lead!.row.name, reverb!.row.name]).toEqual(["Lead", "A Reverb"]);
  });

  it("measures a group's reach and whether anything inside it changed", () => {
    const [drums, lead] = rowTree(SET);

    expect(subtreeSize(drums!)).toBe(3);
    expect(lastIndexOf(drums!)).toBe(3);
    expect(subtreeChanged(drums!)).toBe(true);
    expect(subtreeChanged(lead!)).toBe(false);
  });

  it("stands a row whose group is missing at the top of the set", () => {
    const roots = rowTree([row("Kick", { id: 2, groupId: 99 })]);
    expect(roots.map((node) => node.row.name)).toEqual(["Kick"]);
  });
});

describe("skylineOf", () => {
  it("raises each bar by its chain, up to the ceiling", () => {
    const { bars } = skylineOf({
      rows: [
        row("Empty"),
        row("Half", { devices: chain(CHAIN_CEILING / 2) }),
        row("Heavy", { devices: chain(CHAIN_CEILING * 2) }),
      ],
      truncated: false,
    });

    expect(bars.map((bar) => bar.level)).toEqual([0, 0.5, 1]);
  });

  it("measures a surviving track by the chain it kept, a removed one by the chain it had", () => {
    const { bars } = skylineOf({
      rows: [
        row("Lead", {
          status: "changed",
          devices: [...chain(2), ...chain(2, "removed")],
        }),
        row("Riser", { status: "removed", devices: chain(4, "removed") }),
      ],
      truncated: false,
    });

    expect(bars.map((bar) => bar.level)).toEqual([0.5, 1]);
  });

  it("stands the set's heaviest track full height, however short its chains", () => {
    const { bars } = skylineOf({
      rows: [
        row("Kick", { devices: chain(1) }),
        row("Bass", { devices: chain(3) }),
        row("Pad", { devices: chain(2) }),
      ],
      truncated: false,
    });

    expect(bars.map((bar) => bar.level)).toEqual([1 / 3, 1, 2 / 3]);
  });

  it("marks what the save did to each track", () => {
    const { bars } = skylineOf({
      rows: [
        row("Kept"),
        row("New", { status: "added" }),
        row("Gone", { status: "removed" }),
        row("Moved", { status: "renamed" }),
        row("Tweaked", { status: "changed" }),
      ],
      truncated: false,
    });

    expect(bars.map((bar) => bar.mark)).toEqual([
      null,
      "added",
      "removed",
      "changed",
      "changed",
    ]);
  });

  it("sets the returns apart from the tracks before them", () => {
    const { bars } = skylineOf({ rows: SET, truncated: false });
    expect(bars.map((bar) => bar.busStart)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it("spans each group under the bars it holds, in the group's colour", () => {
    const { spans } = skylineOf({ rows: SET, truncated: false });
    expect(spans).toEqual([
      { from: 0, to: 3, depth: 0, name: "DRUMS", color: "#ff3636" },
      { from: 2, to: 3, depth: 1, name: "PERC", color: "#5480e4" },
    ]);
  });
});
