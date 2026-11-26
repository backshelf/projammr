import type { diffStructure } from "@workspace/session-diff";

/** A save's metadata as dit sends it and the diff reads it. */
type SaveMeta = Parameters<typeof diffStructure>[1];
type Track = NonNullable<SaveMeta["structure"]>["tracks"][number];

/** Saves of Halogen's set, the one session in the demo catalogue
 * (`packages/demo`, `sessions` under the Low Tide project), for the save
 * diffs and the save history the marketing pages draw. The set's top-level
 * groups, its shimmer return, its machine and the move from 124 to 128 BPM
 * on the evening of 14 June follow the catalogue's save history
 * (`packages/demo/src/session-history.ts`); the tracks inside each group are
 * invented here, and the last two saves are composed so one diff shows each
 * kind of change dit reads: a tempo change, clips added, a plugin
 * added and a track removed. No sample paths: the diff draws none without
 * them. */

/** Each group's colour from Live's palette, which its tracks share, as
 * Live's auto-colouring leaves them; the returns and master in its greys.
 * These are the set's own data, the `#rrggbb` a scan stores for each track,
 * not a style: the token layer has no say over the colours a DAW records. */
/* eslint-disable no-restricted-syntax */
const COLOR = {
  drums: "#ff94a6",
  bass: "#ffa529",
  synths: "#5480e4",
  vocals: "#d86ce4",
  returns: "#a9a9a9",
  master: "#3c3c3c",
};
/* eslint-enable no-restricted-syntax */

const group = (
  id: number,
  name: string,
  devices: string[],
  color: string
): Track => ({ id, kind: "group", name, devices, color });

/** The tracks inside one group, numbered on from the group's own id, in its colour. */
const inside = (
  groupId: number,
  color: string,
  tracks: [Track["kind"], string, string[]][]
): Track[] =>
  tracks.map(([kind, name, devices], i) => ({
    id: groupId + i + 1,
    groupId,
    kind,
    name,
    devices,
    color,
  }));

const DRUMS = [
  group(1, "61 DRUMS", ["Glue Compressor"], COLOR.drums),
  ...inside(1, COLOR.drums, [
    ["audio", "Kick", ["EQ Eight", "Glue Compressor"]],
    ["midi", "Kick Sub", ["Operator", "Saturator"]],
    ["audio", "Snare", ["EQ Eight", "Drum Buss"]],
    ["audio", "Clap", ["Hybrid Reverb"]],
    ["audio", "Closed Hat", ["Auto Filter"]],
    ["audio", "Open Hat", ["EQ Eight"]],
    ["audio", "Ride", ["Utility"]],
    ["midi", "Perc", ["Drum Rack", "Echo"]],
    ["audio", "Shaker", ["Auto Pan"]],
    ["midi", "Tom Fill", ["Simpler"]],
  ]),
];

const BASS = [
  group(12, "53 BASS", ["EQ Eight", "Compressor"], COLOR.bass),
  ...inside(12, COLOR.bass, [
    ["midi", "Sub", ["Operator"]],
    ["midi", "Sub Layer", ["Wavetable"]],
    ["midi", "Reese", ["Wavetable", "Roar"]],
    ["audio", "Reese Top", ["Auto Filter"]],
    ["midi", "Pluck Bass", ["Drift"]],
    ["midi", "808", ["Simpler", "Saturator"]],
    ["audio", "Bass FX", ["Echo"]],
    ["midi", "Slide", ["Operator"]],
    ["audio", "Bass Resample", ["Utility"]],
  ]),
];

const SYNTHS = [
  group(22, "15 SYNTHS", ["EQ Eight"], COLOR.synths),
  ...inside(22, COLOR.synths, [
    ["midi", "Pad", ["Wavetable", "Echo"]],
    ["midi", "Arp", ["Drift", "Auto Pan"]],
    ["midi", "Lead", ["Meld", "Chorus-Ensemble"]],
    ["audio", "Riser 1", ["Auto Filter"]],
    ["audio", "Riser 2", ["Hybrid Reverb"]],
    ["midi", "Stab", ["Operator"]],
  ]),
];

const VOCALS = [
  group(29, "2 VOCALS", ["Glue Compressor"], COLOR.vocals),
  ...inside(29, COLOR.vocals, [
    ["audio", "Lead Vox", ["EQ Eight", "Compressor", "Echo"]],
    ["audio", "Lead Dbl L", ["EQ Eight"]],
    ["audio", "Lead Dbl R", ["EQ Eight"]],
    ["audio", "Harmony Hi", ["Utility"]],
    ["audio", "Harmony Lo", ["Utility"]],
    ["audio", "Ad-libs", ["Hybrid Reverb"]],
    ["midi", "Vox Chops", ["Simpler"]],
    ["audio", "Vox FX", ["Echo"]],
    ["audio", "Breath", ["Utility"]],
  ]),
];

const ROOM: Track = {
  id: 39,
  kind: "return",
  name: "A-Room Verb",
  devices: ["Hybrid Reverb"],
  color: COLOR.returns,
};
const MASTER: Track = {
  id: 41,
  kind: "master",
  name: "Master",
  devices: ["Glue Compressor", "Limiter"],
  color: COLOR.master,
};
const shimmer = (devices: string[]): Track => ({
  id: 40,
  kind: "return",
  name: "B-Shimmery Verb",
  devices,
  color: COLOR.returns,
});

const save = (
  tempo: string,
  tracks: Track[],
  clips: { audio: number; midi: number },
  plugins?: NonNullable<SaveMeta["structure"]>["plugins"]
): SaveMeta => ({
  tempo,
  timeSignature: "4/4",
  rootNote: "F",
  scale: "Minor",
  tracksCount: tracks.filter((t) => t.kind !== "return").length,
  scenesCount: 8,
  dawVersion: "12.1",
  samplePaths: null,
  structure: { tracks, clips, scenes: 8, ...(plugins ? { plugins } : {}) },
});

/** The set's name as dit lists it, the session it belongs to, the
 * machine it was saved on, and the zone that machine's clock was in: the
 * UTC+10 every save time below is written in, named as an IANA zone so a
 * page reads its days and times there whatever machine builds the site. The
 * DAW that saved it, and what dit's Ableton module reports of it. */
export const HALOGEN_SET = {
  track: "Halogen",
  file: "halogen long outro.als",
  machine: "Ellis's MacBook Pro",
  timeZone: "Etc/GMT-10",
  daw: "Ableton Live 12.1",
  capabilities: [
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
  ],
};

const HALOGEN_BEFORE = save(
  "124",
  [
    ...DRUMS,
    ...BASS,
    ...SYNTHS,
    ...VOCALS,
    ROOM,
    shimmer(["EQ Eight"]),
    MASTER,
  ],
  { audio: 38, midi: 54 }
);

const HALOGEN_AFTER = save(
  "128",
  [
    ...DRUMS,
    ...BASS,
    ...SYNTHS.filter((t) => t.name !== "Riser 2"),
    ...VOCALS,
    ROOM,
    shimmer(["EQ Eight", "ValhallaShimmer"]),
    MASTER,
  ],
  { audio: 44, midi: 61 },
  { ValhallaShimmer: { host: "vst3", manufacturer: "Valhalla DSP" } }
);

/** An earlier save: the one before `HALOGEN_BEFORE`, with fewer clips. */
const withClips = (audio: number, midi: number): SaveMeta => ({
  ...HALOGEN_BEFORE,
  structure: { ...HALOGEN_BEFORE.structure!, clips: { audio, midi } },
});

/** The set's last four saves, newest first, as dit recorded them:
 * two it read on the evening of the tempo change, and two before them that
 * it filled in from the dated copies in Live's Backup folder. */
export const HALOGEN_HISTORY: {
  at: string;
  source: "scan" | "backup";
  meta: SaveMeta;
}[] = [
  { at: "2026-06-14T21:05:00+10:00", source: "scan", meta: HALOGEN_AFTER },
  { at: "2026-06-14T18:32:00+10:00", source: "scan", meta: HALOGEN_BEFORE },
  {
    at: "2026-06-13T22:10:00+10:00",
    source: "backup",
    meta: withClips(35, 52),
  },
  {
    at: "2026-06-13T19:48:00+10:00",
    source: "backup",
    meta: withClips(35, 48),
  },
];
