import type { SaveMeta, SessionTrack } from "./meta.js";
import { describe, expect, it } from "bun:test";
import { diffFormat } from "./format.js";
import { diffSaves, diffSave, diffStructure } from "./index.js";
import { rowTree } from "./tree.js";

const track = (
  name: string,
  devices: string[] = [],
  kind: SessionTrack["kind"] = "audio"
): SessionTrack => ({ kind, name, devices });

const meta = (over: Partial<SaveMeta> = {}): SaveMeta => ({
  tempo: "126",
  timeSignature: "4/4",
  rootNote: "A",
  scale: "Minor",
  tracksCount: null,
  scenesCount: null,
  dawVersion: null,
  samplePaths: null,
  structure: null,
  ...over,
});

const structure = (
  tracks: SessionTrack[],
  clips = { audio: 0, midi: 0 },
  extra: Partial<
    Pick<NonNullable<SaveMeta["structure"]>, "plugins" | "truncated">
  > = {}
): SaveMeta["structure"] => ({ tracks, clips, ...extra });

const labels = (chips: { label: string }[]): string[] =>
  chips.map((c) => c.label);

describe("diffSaves", () => {
  it("reports the first save as the start of the history", () => {
    expect(diffSaves(null, meta())).toEqual([
      { kind: "first", label: "First save seen" },
    ]);
  });

  it("reports nothing when nothing changed", () => {
    expect(diffSaves(meta(), meta())).toEqual([]);
  });

  it("words the musical fields as transitions", () => {
    const chips = diffSaves(
      meta(),
      meta({ tempo: "128", timeSignature: "3/4", scale: "Major" })
    );

    expect(labels(chips)).toEqual([
      "tempo 126 → 128",
      "time sig 4/4 → 3/4",
      "key A Minor → A Major",
    ]);
    expect(chips).toEqual([
      { kind: "tempo", label: "tempo 126 → 128", from: "126", to: "128" },
      {
        kind: "timeSignature",
        label: "time sig 4/4 → 3/4",
        from: "4/4",
        to: "3/4",
      },
      {
        kind: "key",
        label: "key A Minor → A Major",
        from: "A Minor",
        to: "A Major",
      },
    ]);
  });

  it("treats the root note and scale as one key", () => {
    const chips = diffSaves(meta(), meta({ rootNote: "C" }));
    expect(labels(chips)).toEqual(["key A Minor → C Minor"]);
  });

  it("words keys and tempos as the viewer's formats say", () => {
    const format = diffFormat({
      keyNotation: "camelot",
      tempo: { rounding: "integer", suffix: true },
    });
    const chips = diffSaves(
      meta(),
      meta({ rootNote: "C", tempo: "128.4" }),
      undefined,
      format
    );
    expect(labels(chips)).toEqual(["tempo 126 BPM → 128 BPM", "key 8A → 5A"]);
  });

  it("finds no change in a key that only spells differently", () => {
    const flats = diffFormat({ keyNotation: "flats" });
    expect(
      diffSaves(meta({ rootNote: "C#" }), meta({ rootNote: "C#" }), [], flats)
    ).toEqual([]);
    expect(
      labels(diffSaves(meta(), meta({ rootNote: "C#" }), [], flats))
    ).toEqual(["key A Minor → D♭ Minor"]);
  });

  it("counts tracks added and removed", () => {
    const before = meta({
      structure: structure([track("Vox"), track("Bass", ["Saturator"])]),
    });
    const after = meta({
      structure: structure([
        track("Vox"),
        track("Keys", ["Simpler"]),
        track("Perc", ["Drum Rack"]),
      ]),
    });

    const chips = diffSaves(before, after);
    expect(labels(chips)).toEqual(["+2 tracks", "−1 track"]);
    expect(chips.map((c) => c.sign)).toEqual(["add", "remove"]);
  });

  it("collapses a rename rather than reporting an add and a remove", () => {
    const before = meta({
      structure: structure([track("Vox", ["Reverb"]), track("Bass")]),
    });
    const after = meta({
      structure: structure([track("Vox (dry)", ["Reverb"]), track("Bass")]),
    });

    const chips = diffSaves(before, after);
    expect(labels(chips)).toEqual(["Vox → Vox (dry)"]);
    expect(chips).toEqual([
      {
        kind: "rename",
        label: "Vox → Vox (dry)",
        from: "Vox",
        to: "Vox (dry)",
      },
    ]);
  });

  it("does not read a differently-equipped track at the same index as a rename", () => {
    const before = meta({ structure: structure([track("Vox", ["Reverb"])]) });
    const after = meta({ structure: structure([track("Gtr", ["Saturator"])]) });

    expect(labels(diffSaves(before, after))).toEqual(["+1 track", "−1 track"]);
  });

  it("names the devices added to and removed from a surviving track", () => {
    const before = meta({
      structure: structure([track("Lead", ["Reverb", "EQ Eight"])]),
    });
    const after = meta({
      structure: structure([track("Lead", ["Reverb", "Serum 2"])]),
    });

    const chips = diffSaves(before, after);
    expect(labels(chips)).toEqual(["+Serum 2 on Lead", "−EQ Eight on Lead"]);
    expect(chips.map((c) => c.sign)).toEqual(["add", "remove"]);
  });

  it("sums device changes once there are too many to spell out", () => {
    const before = meta({
      structure: structure([
        track("A"),
        track("B"),
        track("C"),
        track("D"),
        track("E"),
      ]),
    });
    const after = meta({
      structure: structure([
        track("A", ["Reverb"]),
        track("B", ["Reverb"]),
        track("C", ["Reverb"]),
        track("D", ["Reverb"]),
        track("E", ["Reverb"]),
      ]),
    });

    expect(labels(diffSaves(before, after))).toEqual([
      "+Reverb on A",
      "+Reverb on B",
      "+Reverb on C",
      "2 device changes",
    ]);
  });

  it("reports the clip delta in each direction", () => {
    const before = meta({
      structure: structure([], { audio: 20, midi: 4 }),
    });
    const after = meta({
      structure: structure([], { audio: 8, midi: 5 }),
    });

    const chips = diffSaves(before, after);
    expect(labels(chips)).toEqual(["−12 audio clips", "+1 midi clip"]);
    expect(chips.map((c) => c.sign)).toEqual(["remove", "add"]);
  });

  it("counts samples added and removed", () => {
    const before = meta({ samplePaths: ["/kick.wav", "/snare.wav"] });
    const after = meta({ samplePaths: ["/kick.wav", "/hat.wav", "/clap.wav"] });

    const chips = diffSaves(before, after);
    expect(labels(chips)).toEqual(["+2 samples", "−1 sample"]);
    expect(chips.map((c) => c.sign)).toEqual(["add", "remove"]);
  });

  it("says nothing about a set whose structure was never parsed", () => {
    const before = meta({ structure: null });
    const after = meta({ structure: null, tempo: "130" });

    expect(labels(diffSaves(before, after))).toEqual(["tempo 126 → 130"]);
  });

  it('compares tempo as a number, so "126" and "126.0" are no change', () => {
    expect(diffSaves(meta(), meta({ tempo: "126.0" }))).toEqual([]);
  });

  it("counts scenes added and removed", () => {
    const chips = diffSaves(
      meta({ scenesCount: 8 }),
      meta({ scenesCount: 10 })
    );
    expect(chips).toEqual([
      { kind: "scenes", label: "+2 scenes", sign: "add" },
    ]);
  });

  it("names the DAW version a set was first saved in", () => {
    const chips = diffSaves(
      meta({ dawVersion: "Ableton Live 12.2" }),
      meta({ dawVersion: "Ableton Live 12.3" })
    );
    expect(chips).toEqual([
      {
        kind: "dawVersion",
        label: "Ableton Live 12.2 → Ableton Live 12.3",
        from: "Ableton Live 12.2",
        to: "Ableton Live 12.3",
      },
    ]);
  });

  it("compares only what the DAW says it reports", () => {
    const before = meta({ samplePaths: ["/kick.wav"] });
    const after = meta({ tempo: "130", samplePaths: ["/snare.wav"] });

    expect(labels(diffSaves(before, after, ["tempo"]))).toEqual([
      "tempo 126 → 130",
    ]);
    expect(labels(diffSaves(before, after, ["samplePaths"]))).toEqual([
      "+1 sample",
      "−1 sample",
    ]);
  });

  it("keeps the chips in a fixed order", () => {
    const before = meta({
      samplePaths: ["/kick.wav"],
      structure: structure([track("Vox", ["Reverb"])], { audio: 4, midi: 0 }),
    });
    const after = meta({
      tempo: "130",
      samplePaths: ["/kick.wav", "/snare.wav"],
      structure: structure(
        [track("Vox", ["Reverb", "Serum 2"]), track("Keys")],
        {
          audio: 6,
          midi: 0,
        }
      ),
    });

    expect(diffSaves(before, after).map((c) => c.kind)).toEqual([
      "tempo",
      "tracks",
      "devices",
      "clips",
      "samples",
    ]);
  });
});

describe("diffStructure", () => {
  it("gives every row `same` when there is no previous save", () => {
    const after = meta({
      structure: structure([track("Vox", ["Reverb"]), track("Bass")]),
    });
    const diff = diffStructure(null, after);

    expect(diff.rows.map((r) => r.status)).toEqual(["same", "same"]);
  });

  it("carries each track's colour, a removed track's from the save it left", () => {
    const coloured = (name: string, color: string): SessionTrack => ({
      ...track(name),
      color,
    });
    const before = meta({
      structure: structure([
        coloured("Vox", "#ff3636"),
        coloured("Riser", "#5480e4"),
      ]),
    });
    const after = meta({
      structure: structure([coloured("Vox", "#ffa529")]),
    });

    const diff = diffStructure(before, after);
    expect(diff.rows.map((r) => [r.name, r.status, r.color])).toEqual([
      ["Vox", "same", "#ffa529"],
      ["Riser", "removed", "#5480e4"],
    ]);
  });

  it("names the format each plugin on a chain is hosted in", () => {
    const after = meta({
      structure: structure([track("Lead", ["Serum 2", "Reverb"])], undefined, {
        plugins: { "Serum 2": { host: "clap" } },
      }),
    });

    expect(diffStructure(null, after).rows[0]!.devices).toEqual([
      { name: "Serum 2", status: "same", origin: "plugin", host: "clap" },
      { name: "Reverb", status: "same", origin: "builtin" },
    ]);
  });

  it("carries the DAW's track id and group id onto every row", () => {
    const grouped = (
      name: string,
      id: number,
      groupId?: number,
      kind: SessionTrack["kind"] = "audio"
    ): SessionTrack => ({
      kind,
      name,
      devices: [],
      id,
      ...(groupId != null && { groupId }),
    });

    const after = meta({
      structure: structure([
        grouped("DRUMS", 73, undefined, "group"),
        grouped("Snare", 74, 73),
        grouped("PERC", 107, 73, "group"),
        grouped("Shaker", 106, 107),
      ]),
    });

    const diff = diffStructure(null, after);
    expect(diff.rows.map((r) => [r.name, r.id, r.groupId])).toEqual([
      ["DRUMS", 73, undefined],
      ["Snare", 74, 73],
      ["PERC", 107, 73],
      ["Shaker", 106, 107],
    ]);
  });

  it("carries a removed row's ids from the save it disappeared from", () => {
    const inGroup = (
      name: string,
      id: number,
      groupId: number
    ): SessionTrack => ({
      kind: "audio",
      name,
      devices: [],
      id,
      groupId,
    });

    const before = meta({
      structure: structure([inGroup("Snare", 74, 73), inGroup("Hats", 75, 73)]),
    });
    const after = meta({ structure: structure([inGroup("Snare", 74, 73)]) });

    const diff = diffStructure(before, after);
    const removed = diff.rows.find((r) => r.status === "removed");
    expect(removed).toMatchObject({ name: "Hats", id: 75, groupId: 73 });
  });

  it("leaves rows without ids when the set was parsed before groups were read", () => {
    const after = meta({ structure: structure([track("Vox"), track("Bass")]) });

    const diff = diffStructure(null, after);
    for (const row of diff.rows) {
      expect(row.id).toBeUndefined();
      expect(row.groupId).toBeUndefined();
    }
  });

  it("marks a paired add/remove as one renamed row carrying `was`", () => {
    const before = meta({
      structure: structure([track("Vox", ["Reverb"]), track("Bass")]),
    });
    const after = meta({
      structure: structure([track("Vox (dry)", ["Reverb"]), track("Bass")]),
    });

    const diff = diffStructure(before, after);
    const renamed = diff.rows.find((r) => r.status === "renamed");
    expect(renamed).toMatchObject({ name: "Vox (dry)", was: "Vox" });
  });

  it("re-emits a removed track at its former index", () => {
    const before = meta({
      structure: structure([track("Vox"), track("Bass"), track("Drum")]),
    });
    const after = meta({
      structure: structure([track("Vox"), track("Drum")]),
    });

    const diff = diffStructure(before, after);
    expect(diff.rows.map((r) => [r.name, r.status])).toEqual([
      ["Vox", "same"],
      ["Bass", "removed"],
      ["Drum", "same"],
    ]);
  });

  it("marks a kept track `changed` with one `added` device row when a device is added", () => {
    const before = meta({ structure: structure([track("Lead", ["Reverb"])]) });
    const after = meta({
      structure: structure([track("Lead", ["Reverb", "Serum 2"])]),
    });

    const diff = diffStructure(before, after);
    expect(diff.rows).toEqual([
      {
        key: expect.any(String),
        kind: "audio",
        name: "Lead",
        was: undefined,
        status: "changed",
        devices: [
          { name: "Reverb", status: "same", origin: "builtin" },
          { name: "Serum 2", status: "added", origin: "builtin" },
        ],
      },
    ]);
  });

  it("appends a removed device at the chain's end", () => {
    const before = meta({
      structure: structure([track("Lead", ["Reverb", "EQ Eight"])]),
    });
    const after = meta({ structure: structure([track("Lead", ["Reverb"])]) });

    const diff = diffStructure(before, after);
    expect(diff.rows[0]!.devices).toEqual([
      { name: "Reverb", status: "same", origin: "builtin" },
      { name: "EQ Eight", status: "removed", origin: "builtin" },
    ]);
  });

  it("reads a device's origin from either side's plugin map", () => {
    const before = meta({
      structure: structure([track("Lead", ["Serum 2"])], undefined, {
        plugins: { "Serum 2": { host: "vst3" } },
      }),
    });
    const after = meta({
      structure: structure([track("Lead", ["Serum 2", "Reverb"])]),
    });

    const diff = diffStructure(before, after);
    expect(diff.rows[0]!.devices).toEqual([
      { name: "Serum 2", status: "same", origin: "plugin", host: "vst3" },
      { name: "Reverb", status: "added", origin: "builtin" },
    ]);
  });

  it("marks the diff truncated when either side's structure was truncated", () => {
    const before = meta({
      structure: structure([], undefined, { truncated: true }),
    });
    const after = meta({ structure: structure([]) });

    expect(diffStructure(before, after).truncated).toBe(true);
  });
});

describe("diffSave", () => {
  const ABLETON = [
    "tempo",
    "key",
    "timeSignature",
    "dawVersion",
    "structure",
    "clips",
    "scenes",
    "plugins",
    "samplePaths",
    "backups",
    "trackColors",
  ];

  it("sets each moved value on its gauge, in facet order", () => {
    const before = meta({
      tempo: "124",
      structure: structure([track("Vox")], { audio: 38, midi: 54 }),
    });
    const after = meta({
      tempo: "128.0",
      structure: structure([track("Vox")], { audio: 44, midi: 54 }),
    });

    const { readouts } = diffSave(before, after, ABLETON);
    expect(readouts.map((r) => r.gauge)).toEqual(["ruler", "meters"]);
    expect(readouts[0]).toMatchObject({
      label: "Tempo",
      from: 124,
      to: 128,
    });
    expect(readouts[1]).toEqual({
      gauge: "meters",
      label: "Clips",
      meters: [
        { label: "Audio", from: 38, to: 44 },
        { label: "MIDI", from: 54, to: 54 },
      ],
    });
  });

  it("draws a first save as the set, with nothing moved", () => {
    const after = meta({ structure: structure([track("Vox")]) });
    const diff = diffSave(null, after, ABLETON);

    expect(diff).toMatchObject({
      first: true,
      changed: false,
      chips: [],
      readouts: [],
      samples: { added: [], removed: [] },
    });
    expect(diff.structure?.rows.map((r) => r.status)).toEqual(["same"]);
  });

  it("reads nothing a DAW does not claim to report", () => {
    const before = meta({ samplePaths: ["/kick.wav"] });
    const after = meta({
      tempo: "130",
      samplePaths: ["/snare.wav"],
      structure: structure([track("Vox")]),
    });

    const diff = diffSave(before, after, ["tempo"]);
    expect(diff.structure).toBeNull();
    expect(diff.samples).toEqual({ added: [], removed: [] });
    expect(diff.colors).toBe(false);
    expect(diff.chips.map((c) => c.kind)).toEqual(["tempo"]);
  });

  it("compares whatever the saves carry for a session whose DAW's claims were never recorded", () => {
    const before = meta({ structure: structure([track("Vox")]) });
    const after = meta({
      tempo: "130",
      structure: structure([track("Vox"), track("Keys")]),
    });

    const diff = diffSave(before, after, []);
    expect(diff.chips.map((c) => c.kind)).toEqual(["tempo", "tracks"]);
    expect(diff.structure?.rows).toHaveLength(2);
    expect(diff.colors).toBe(false);
  });

  it("lists the samples a save added and dropped", () => {
    const diff = diffSave(
      meta({ samplePaths: ["/kick.wav", "/snare.wav"] }),
      meta({ samplePaths: ["/kick.wav", "/hat.wav"] }),
      ABLETON
    );

    expect(diff.samples).toEqual({
      added: ["/hat.wav"],
      removed: ["/snare.wav"],
    });
  });

  it("says nothing moved when two saves read the same", () => {
    const save = meta({ structure: structure([track("Vox", ["Reverb"])]) });
    expect(diffSave(save, save, ABLETON)).toMatchObject({
      first: false,
      changed: false,
    });
  });

  it("ignores invalid tempo strings instead of emitting NaN", () => {
    expect(diffSaves(meta({ tempo: "abc" }), meta({ tempo: "NaN" }))).toEqual(
      []
    );
    expect(diffSaves(meta({ tempo: "126" }), meta({ tempo: "" }))).toEqual([]);
    expect(
      labels(diffSaves(meta({ tempo: "invalid" }), meta({ tempo: "128" })))
    ).toEqual(["tempo — → 128"]);
  });

  it("diffs duplicate device instances as a multiset", () => {
    const before = meta({
      structure: structure([track("Bass", ["EQ Eight"])]),
    });
    const added = meta({
      structure: structure([track("Bass", ["EQ Eight", "EQ Eight"])]),
    });
    expect(labels(diffSaves(before, added))).toEqual(["+EQ Eight on Bass"]);
    expect(
      diffStructure(before, added).rows[0]?.devices.map((d) => [
        d.name,
        d.status,
      ])
    ).toEqual([
      ["EQ Eight", "same"],
      ["EQ Eight", "added"],
    ]);

    expect(labels(diffSaves(added, before))).toEqual(["−EQ Eight on Bass"]);
    expect(
      diffStructure(added, before).rows[0]?.devices.map((d) => [
        d.name,
        d.status,
      ])
    ).toEqual([
      ["EQ Eight", "same"],
      ["EQ Eight", "removed"],
    ]);
  });

  it("disambiguates duplicate track names and prefers track IDs when present", () => {
    const beforeDup = meta({
      structure: structure([track("Audio", ["Reverb"]), track("Audio", [])]),
    });
    const afterDup = meta({
      structure: structure([
        track("Audio", ["Reverb"]),
        track("Audio", ["Delay"]),
        track("Audio", []),
      ]),
    });
    expect(labels(diffSaves(beforeDup, afterDup))).toEqual([
      "+1 track",
      "+Delay on Audio",
    ]);

    const beforeById = meta({
      structure: structure([
        { kind: "audio", name: "Vox", devices: ["Reverb"], id: 1 },
        { kind: "audio", name: "Vox", devices: ["Delay"], id: 2 },
      ]),
    });
    const afterById = meta({
      structure: structure([
        {
          kind: "audio",
          name: "Lead Vox",
          devices: ["Reverb", "EQ Eight"],
          id: 1,
        },
        { kind: "audio", name: "Vox", devices: ["Delay"], id: 2 },
      ]),
    });
    expect(labels(diffSaves(beforeById, afterById))).toEqual([
      "Vox → Lead Vox",
      "+EQ Eight on Lead Vox",
    ]);
  });

  it("guards rowTree against multi-node groupId cycles", () => {
    const rows = diffStructure(
      null,
      meta({
        structure: structure([
          { kind: "group", name: "Group A", devices: [], id: 1, groupId: 2 },
          { kind: "group", name: "Group B", devices: [], id: 2, groupId: 1 },
        ]),
      })
    ).rows;
    const roots = rowTree(rows);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.row.id).toBe(2);
    expect(roots[0]?.children.map((c) => c.row.id)).toEqual([1]);
    expect(roots[0]?.children[0]?.children).toEqual([]);
  });

  it("ignores track-number shifts on auto-numbered tracks when an earlier track is deleted", () => {
    const t = (
      name: string,
      id?: number,
      kind: SessionTrack["kind"] = "audio"
    ): SessionTrack => ({ kind, name, devices: [], ...(id != null && { id }) });

    // With explicit DAW track ids (saved Ableton sets).
    const before = meta({
      structure: structure([
        t("1-Deleted", 10),
        t("2 Audio", 11),
        t("3-Group", 12, "group"),
        t("4-Serum 2", 13, "midi"),
        t("05 Kick", 14),
        t("6-119-Audio 0001", 15),
        t("Audio #1", 16),
        t("A Reverb", 17, "return"),
        t("B Delay", 18, "return"),
      ]),
    });
    const after = meta({
      structure: structure([
        t("1 Audio", 11),
        t("2-Group", 12, "group"),
        t("3-Serum 2", 13, "midi"),
        t("04 Kick", 14),
        t("5-119-Audio 0001", 15),
        t("Audio #1", 16),
        t("A Delay", 18, "return"),
      ]),
    });
    expect(labels(diffSaves(before, after))).toEqual(["−2 tracks"]);
    expect(
      diffStructure(before, after)
        .rows.filter((r) => r.status !== "same")
        .map((r) => [r.name, r.status])
    ).toEqual([
      ["1-Deleted", "removed"],
      ["A Reverb", "removed"],
    ]);

    // Without track ids (name matching across shifted numbers).
    const beforeNoId = meta({
      structure: structure([
        t("1-Deleted"),
        t("2 Audio"),
        t("3-Group", undefined, "group"),
        t("4-Serum 2", undefined, "midi"),
      ]),
    });
    const afterNoId = meta({
      structure: structure([
        t("1 Audio"),
        t("2-Group", undefined, "group"),
        t("3-Serum 2", undefined, "midi"),
      ]),
    });
    expect(labels(diffSaves(beforeNoId, afterNoId))).toEqual(["−1 track"]);

    // Genuine renames on shifted tracks are still reported.
    const renamedAfter = meta({
      structure: structure([
        t("1 Vox", 11),
        t("Group", 12, "group"),
        t("3-Serum 2", 13, "midi"),
        t("04 Kick", 14),
        t("5-119-Audio 0001", 15),
        t("Audio #1", 16),
        t("A Delay", 18, "return"),
      ]),
    });
    expect(labels(diffSaves(before, renamedAfter))).toEqual([
      "−2 tracks",
      "2 Audio → 1 Vox",
      "3-Group → Group",
    ]);
  });
});
