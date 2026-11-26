import { describe, expect, test } from "bun:test";
import type { StructureDiff } from "@workspace/session-diff";

import type { SetMeta, StructureTrack } from "../ipc";
import { base } from "../test-support";
import {
  describeRow,
  litRows,
  skylineStructure,
  summarize,
} from "./skyline-model";

const head = base.headMeta as SetMeta;
const latest = base.latestMeta as SetMeta;

const drums: StructureTrack = {
  kind: "audio",
  name: "Drums",
  devices: ["Drum Rack"],
  id: 1,
};
const bass: StructureTrack = {
  kind: "midi",
  name: "Bass",
  devices: ["Operator"],
  id: 2,
};
const bassWithEq: StructureTrack = {
  ...bass,
  devices: ["Operator", "EQ Eight"],
};

const statuses = (structure: StructureDiff | null): string[][] | undefined =>
  structure?.rows.map((row) => [row.name, row.status]);

describe("the skyline's rows", () => {
  test("light the tracks the newest save changed since the last commit", () => {
    const structure = skylineStructure({
      head,
      latest,
      live: null,
      changed: [],
    });

    expect(statuses(structure)).toEqual([
      ["Drums", "same"],
      ["Bass", "changed"],
      ["Pad", "added"],
      ["Master", "same"],
    ]);
    expect(litRows(structure!).map((row) => row.name)).toEqual(["Bass", "Pad"]);
  });

  test("light a track whose content changed though its devices did not, by the names the app reads", () => {
    const structure = skylineStructure({
      head,
      latest,
      live: null,
      changed: ["Drums", "Bass"],
    });

    expect(statuses(structure)).toEqual([
      ["Drums", "changed"],
      ["Bass", "changed"],
      ["Pad", "added"],
      ["Master", "same"],
    ]);
  });

  test("draw the script's latest tracks as a set of their own, ahead of any save", () => {
    const structure = skylineStructure({
      head,
      latest,
      live: [drums, bassWithEq, { ...head.structure!.tracks[2]! }],
      changed: [],
    });

    expect(statuses(structure)).toEqual([
      ["Drums", "same"],
      ["Bass", "changed"],
      ["Master", "same"],
    ]);
  });

  test("make every track new in a set with no commit", () => {
    const structure = skylineStructure({
      head: null,
      latest,
      live: null,
      changed: [],
    });

    expect(structure?.rows.every((row) => row.status === "added")).toBe(true);
  });

  test("light nothing when the newest save is the commit's own", () => {
    const structure = skylineStructure({
      head,
      latest: head,
      live: null,
      changed: [],
    });

    expect(litRows(structure!)).toEqual([]);
  });

  test("are none while no set has tracks to draw", () => {
    expect(
      skylineStructure({ head, latest: null, live: null, changed: [] })
    ).toBeNull();
    expect(
      skylineStructure({
        head,
        latest: { ...latest, structure: null },
        live: null,
        changed: [],
      })
    ).toBeNull();
  });
});

describe("naming a track", () => {
  const structure = skylineStructure({
    head,
    latest,
    live: null,
    changed: [],
  })!;
  const named = (name: string): string =>
    describeRow(structure.rows.find((row) => row.name === name)!);

  test("a lit track names what it gained", () => {
    expect(named("Bass")).toBe("Bass \u00b7 +EQ Eight");
  });

  test("an added track says so", () => {
    expect(named("Pad")).toBe("Pad \u00b7 added");
  });

  test("a track as it was is named with its chain", () => {
    expect(named("Drums")).toBe("Drums \u00b7 1 device");
    expect(named("Master")).toBe("Master");
  });

  test("a track lit by its content alone says it was edited", () => {
    const edited = skylineStructure({
      head,
      latest,
      live: null,
      changed: ["Drums"],
    })!;

    expect(describeRow(edited.rows[0]!)).toBe("Drums \u00b7 edited");
  });

  test("a device taken off is a minus", () => {
    const removed = skylineStructure({
      head: { ...head, structure: { tracks: [bassWithEq] } },
      latest: { ...latest, structure: { tracks: [bass] } },
      live: null,
      changed: [],
    })!;

    expect(describeRow(removed.rows[0]!)).toBe("Bass \u00b7 \u2212EQ Eight");
  });

  test("a renamed track names the track it was", () => {
    const renamed = skylineStructure({
      head: { ...head, structure: { tracks: [drums] } },
      latest: { ...latest, structure: { tracks: [{ ...drums, name: "Kit" }] } },
      live: null,
      changed: [],
    })!;

    expect(describeRow(renamed.rows[0]!)).toBe("Kit \u00b7 was Drums");
  });

  test("the summary counts the lit tracks, or says there are none", () => {
    expect(summarize(structure, true)).toBe(
      "2 tracks changed since the last commit"
    );
    expect(summarize(structure, false)).toBe("4 tracks, none committed yet");
    expect(
      summarize(
        skylineStructure({ head, latest: head, live: null, changed: [] })!,
        true
      )
    ).toBe("No track has changed since the last commit");
  });
});
