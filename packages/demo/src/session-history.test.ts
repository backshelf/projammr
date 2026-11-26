import { describe, expect, it } from "bun:test";
import type { DemoSet } from "./demo-set";
import type { DemoSession } from "./model";
import { buildHistory, rebaseHome, utcOffsetMs } from "./session-history";

const set: DemoSet = {
  tempo: 128,
  timeSignature: "4/4",
  tracksCount: 5,
  dawVersion: "Ableton Live 12.3",
  samples: ["a", "b", "c", "d"].map((name) => ({
    path: `/Users/someone/${name}.wav`,
    kind: "outside",
    status: "present",
  })),
  structure: {
    tracks: [
      { kind: "group", name: "DRUMS", devices: ["Glue Compressor"], id: 1 },
      { kind: "audio", name: "Kick", devices: [], id: 2, groupId: 1 },
      { kind: "group", name: "BASS", devices: [], id: 3 },
      {
        kind: "midi",
        name: "Sub",
        devices: ["Serum 2", "Saturator"],
        id: 4,
        groupId: 3,
      },
      { kind: "audio", name: "Vox", devices: ["Echo"], id: 6 },
      { kind: "return", name: "A-Verb", devices: ["ValhallaShimmer"], id: 5 },
    ],
    clips: { audio: 100, midi: 40 },
    plugins: { "Serum 2": { host: "au" }, ValhallaShimmer: { host: "au" } },
  },
};

const session: DemoSession = {
  key: "test",
  track: "t",
  main: true,
  localPath: "/Users/ellis/Music/test Project/test.als",
  home: "/Users/ellis",
  machine: "Studio",
  savedAt: "2026-07-01T21:00:00+10:00",
  savedMessage: "Final",
  history: [
    {
      at: "2026-05-01T20:00:00+10:00",
      tempo: 120,
      topLevel: ["DRUMS"],
      returns: false,
      message: "Drums",
      saves: 2,
    },
    {
      at: "2026-06-01T20:00:00+10:00",
      tempo: 124,
      topLevel: ["DRUMS", "BASS"],
      returns: true,
      missingDevices: { Sub: ["Saturator"] },
      message: "Bass and returns",
      saves: 3,
    },
  ],
};

const names = (meta: { structure: { tracks: { name: string }[] } | null }) =>
  meta.structure?.tracks.map((t) => t.name);

describe("buildHistory", () => {
  it("records every milestone and the saves between them, oldest first and before the current save", () => {
    const saves = buildHistory(set, session);
    expect(saves).toHaveLength(2 + 2 + 3);
    const times = saves.map((s) => s.fileUpdatedAt);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(new Set(times).size).toBe(times.length);
    expect(times[0]).toBe(Date.parse(session.history[0]!.at));
    expect(times.at(-1)!).toBeLessThan(Date.parse(session.savedAt));
  });

  it("shows only a milestone's top-level tracks, with everything inside them", () => {
    const [first] = buildHistory(set, session);
    expect(first!.kind).toBe("milestone");
    expect(names(first!.meta)).toEqual(["DRUMS", "Kick"]);
    expect(first!.meta.tempo).toBe("120");
    expect(first!.meta.structure?.plugins).toBeUndefined();
  });

  it("leaves out the devices a milestone lacks and the plugins nothing uses yet", () => {
    const second = buildHistory(set, session).find(
      (s) => s.fileUpdatedAt === Date.parse(session.history[1]!.at)
    )!;
    expect(names(second.meta)).toEqual([
      "DRUMS",
      "Kick",
      "BASS",
      "Sub",
      "A-Verb",
    ]);
    expect(
      second.meta.structure?.tracks.find((t) => t.name === "Sub")?.devices
    ).toEqual(["Serum 2"]);
    expect(Object.keys(second.meta.structure?.plugins ?? {}).sort()).toEqual([
      "Serum 2",
      "ValhallaShimmer",
    ]);
    expect(second.meta.tempo).toBe("124");
  });

  it("grows clips and samples between milestones without ever going back", () => {
    const saves = buildHistory(set, session);
    const audio = saves.map((s) => s.meta.structure!.clips!.audio);
    const samples = saves.map((s) => s.meta.samplePaths!.length);
    expect(audio.every((n, i) => i === 0 || n >= audio[i - 1]!)).toBe(true);
    expect(samples.every((n, i) => i === 0 || n >= samples[i - 1]!)).toBe(true);
    expect(saves.filter((s) => s.kind === "between")).toHaveLength(5);
  });

  it("puts the saves between milestones in the evening on the producer's clock", () => {
    const offset = utcOffsetMs(session.savedAt);
    for (const save of buildHistory(set, session).filter(
      (s) => s.kind === "between"
    )) {
      const local = new Date(save.fileUpdatedAt + offset);
      expect(local.getUTCHours()).toBeGreaterThanOrEqual(18);
    }
  });

  it("lays the saves out the same way every run", () => {
    expect(buildHistory(set, session)).toEqual(buildHistory(set, session));
  });

  it("refuses a milestone naming a top-level track the set does not have", () => {
    const bad = {
      ...session,
      history: [{ ...session.history[0]!, topLevel: ["SYNTHS"] }],
    };
    expect(() => buildHistory(set, bad)).toThrow('no top-level track "SYNTHS"');
  });

  it("refuses a milestone removing a device the track does not carry", () => {
    const bad = {
      ...session,
      history: [
        { ...session.history[1]!, missingDevices: { Sub: ["Reaktor 6"] } },
      ],
    };
    expect(() => buildHistory(set, bad)).toThrow("Reaktor 6");
  });

  it("refuses a set with no structure", () => {
    expect(() =>
      buildHistory({ ...set, structure: undefined }, session)
    ).toThrow("no structure");
  });
});

describe("rebaseHome", () => {
  it("moves a macOS or Linux home onto the given one and leaves other paths alone", () => {
    expect(
      rebaseHome(
        [
          "/Users/someone/Music/a.wav",
          "/home/x/b.wav",
          "/Volumes/Samples/c.wav",
        ],
        "/Users/ellis"
      )
    ).toEqual([
      "/Users/ellis/Music/a.wav",
      "/Users/ellis/b.wav",
      "/Volumes/Samples/c.wav",
    ]);
  });
});

describe("utcOffsetMs", () => {
  it("reads the offset an ISO timestamp carries", () => {
    expect(utcOffsetMs("2026-05-01T20:00:00+10:00")).toBe(10 * 3_600_000);
    expect(utcOffsetMs("2026-05-01T20:00:00-03:30")).toBe(-3.5 * 3_600_000);
    expect(utcOffsetMs("2026-05-01T20:00:00Z")).toBe(0);
  });
});
