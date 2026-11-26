import type { RenderCard } from "../ipc";

/** The size a bytes formatter reads as "1 MB". */
export const MB = 1024 * 1024;

/** A render waiting on the person: one wav in the exports folder, matched to the open set. A test bends it. */
export function card(changes: Partial<RenderCard> = {}): RenderCard {
  return {
    id: 7,
    name: "science123 v4",
    state: "proposed",
    files: [
      {
        path: "/Users/producer/Music/Exports/science123 v4.wav",
        size: 48 * MB,
      },
    ],
    batch: null,
    uploadedFile: null,
    pairNote: null,
    progress: null,
    score: 0.82,
    reasons: [
      "Named like \u201cscience123\u201d",
      "4 min after your last save",
    ],
    sessionId: 812,
    bouncedAfterMs: 240_000,
    reasonKinds: { named: true, inFolder: true, nearSave: true },
    message: null,
    durationMs: 222_000,
    set: "science123",
    otherSets: [],
    ...changes,
  };
}

/** The same bounce exported as a wav and an mp3: one card, the wav (the larger) going up. */
export function pair(changes: Partial<RenderCard> = {}): RenderCard {
  return card({
    id: 8,
    files: [
      {
        path: "/Users/producer/Music/Exports/science123 v4.wav",
        size: 48 * MB,
      },
      {
        path: "/Users/producer/Music/Exports/science123 v4.mp3",
        size: 9 * MB,
      },
    ],
    uploadedFile: 0,
    pairNote:
      "science123 v4.wav + science123 v4.mp3: will upload science123 v4.wav",
    ...changes,
  });
}
