import type { RenderCard, RenderFile, RenderProgress } from "../ipc";

/** The last segment of a path, whichever separator it was written with. */
export function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** The folder a path is in; empty for a bare name. */
export function folderOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut > 0 ? path.slice(0, cut) : "";
}

/** The extension with its dot (".wav"), or an empty string when the name has none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

/** Whether the person has a decision to make on the card: add it, or turn it down. */
export function isDecidable(card: RenderCard): boolean {
  return card.state === "proposed" || card.state === "over-limit";
}

/** The cards the panel shows: a render still held back by the app's minute of waiting has no card yet. */
export function visibleCards(cards: readonly RenderCard[]): RenderCard[] {
  return cards.filter((card) => card.state !== "waiting");
}

/** The index of the file a card plays and names first: the one that is uploaded, else the largest. */
export function mainFileIndex(card: RenderCard): number {
  const chosen = card.uploadedFile;
  if (chosen !== null && card.files[chosen]) return chosen;
  let largest = 0;
  card.files.forEach((file, index) => {
    if ((card.files[largest]?.size ?? 0) < file.size) largest = index;
  });
  return largest;
}

/** The file a card plays; null for a card with no file. */
export function mainFile(card: RenderCard): RenderFile | null {
  return card.files[mainFileIndex(card)] ?? null;
}

/**
 * What the card calls its files: the one name, or for a pair of formats the first name in full and the others as
 * their extension ("science123 v4.wav and .mp3"); files of other stems keep their full names.
 */
export function namesOf(card: RenderCard): string {
  const names = card.files.map((file) => fileName(file.path));
  if (names.length === 0) return card.name;
  const [first = card.name, ...rest] = names;
  const stem = first.slice(0, first.length - extensionOf(first).length);
  const short = rest.map((name) =>
    name.startsWith(stem) && extensionOf(name) === name.slice(stem.length)
      ? extensionOf(name)
      : name
  );
  const all = [first, ...short];
  if (all.length === 1) return first;
  return `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`;
}

/** Whether the render is more than one file of one bounce. */
export function isPair(card: RenderCard): boolean {
  return card.files.length > 1;
}

/** "uploads the .wav (48 MB)" for the file a pair sends; null for a render of one file or one with no choice yet. */
export function uploadsLine(
  card: RenderCard,
  bytes: (size: number) => string
): string | null {
  if (!isPair(card) || card.state === "over-limit") return null;
  const chosen =
    card.uploadedFile === null ? null : card.files[card.uploadedFile];
  if (!chosen) return null;
  const tense = card.state === "added" ? "uploaded" : "uploads";
  return `${tense} the ${extensionOf(fileName(chosen.path))} (${bytes(chosen.size)})`;
}

/** How far the upload is, as a whole percent; 0 before the first byte and for a file of no size. */
export function percentOf(progress: RenderProgress | null): number {
  if (!progress || progress.total <= 0) return 0;
  return Math.min(100, Math.floor((progress.sent / progress.total) * 100));
}

/** The formatters a card's facts and reasons read; `useFormat()` satisfies it. */
export type RenderFormat = {
  timecode: (ms: number) => string;
  bytes: (size: number) => string;
  timeInSet: (seconds: number) => string;
};

/**
 * How far from the last save, as the spec words it: "4 min", "2h 14m" from an hour, and "less than a minute" for a
 * bounce made the moment after (or before) it. Always positive; {@link saveDistance} says which side.
 */
function spanOf(ms: number, format: Pick<RenderFormat, "timeInSet">): string {
  const minutes = Math.round(Math.abs(ms) / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} min`;
  return format.timeInSet(Math.round(Math.abs(ms) / 1000));
}

/** "4 min after your last save", or "4 min before" for a file written first; null when the daemon has no distance. */
function saveDistance(
  bouncedAfterMs: number | null,
  format: Pick<RenderFormat, "timeInSet">
): string | null {
  if (bouncedAfterMs === null) return null;
  const side = bouncedAfterMs < 0 ? "before" : "after";
  return `${spanOf(bouncedAfterMs, format)} ${side} your last save`;
}

/**
 * The line of facts under a card's name: its length, how long after the last save it was bounced, its size, how many
 * files it is one of, and for a pair which file goes up. `length` is the one the player read when the render's own
 * is not known.
 */
export function factsOf(
  card: RenderCard,
  format: RenderFormat,
  length?: number
): string[] {
  const facts: string[] = [];
  const duration = card.durationMs ?? (length ? length * 1000 : null);
  if (duration !== null && duration > 0) facts.push(format.timecode(duration));
  const distance = saveDistance(card.bouncedAfterMs, format);
  if (distance !== null) facts.push(`bounced ${distance}`);
  const main = mainFile(card);
  if (main && main.size > 0 && !isPair(card))
    facts.push(format.bytes(main.size));
  if (card.batch !== null) facts.push(`${card.batch} files`);
  const uploads = uploadsLine(card, format.bytes);
  if (uploads) facts.push(uploads);
  return facts;
}

/**
 * Why the engine offered the file, in the spec's words and order: "named like the set", "in its folder".
 * Save-distance timing is already shown in {@link factsOf} so it is not repeated here.
 */
export function reasonsOf(card: RenderCard): string[] {
  const { named, inFolder } = card.reasonKinds;
  const reasons: string[] = [];
  if (named) reasons.push("named like the set");
  if (inFolder) reasons.push("in its folder");
  return reasons;
}
