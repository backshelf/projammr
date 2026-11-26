import type { SessionSave } from "@workspace/api/api";
import type { RulerConfig } from "@workspace/session-diff/ruler";
import {
  commitRowId,
  type LogCommit,
  saveRowId,
} from "@workspace/ui/lib/commit-log";
import { positionOf } from "@workspace/ui/lib/ruler-scale";

/**
 * The commit ruler's model, apart from the component so mark placement, the
 * brush and the keyboard walk can be checked without a DOM. A ruler is the
 * session's history on a time axis: every save a faint tick, every commit a
 * mark (checkpoints lighter), one lane per machine.
 */

/** A point on the ruler: a save (a tick) or a commit (a mark). */
export type RulerState = {
  /** Unique across saves and commits. */
  key: string;
  kind: "save" | "commit" | "checkpoint";
  /** The save this state stands for: a save's own, or the commit's own save. */
  saveId: number;
  /** The save before it on its branch, where known: the `from` of a compare of this alone. */
  baselineSaveId: number | null;
  /** Epoch milliseconds. */
  at: number;
  /** The machine it came from, `null` for an unnamed one. */
  machine: string | null;
  /** The DOM id of the log row it scrolls to. */
  rowId: string;
  /** What hovering it says. */
  title: string;
  /** The commit it is, when it is one. */
  commitId: number | null;
};

/** A commit as the ruler needs it, so a page hands over no more of the log than that. */
export type RulerCommit = Pick<
  LogCommit,
  | "id"
  | "kind"
  | "message"
  | "authorName"
  | "machineName"
  | "committedAt"
  | "saveId"
  | "baselineSaveId"
>;

/** A save as the ruler needs it. */
export type RulerSave = Pick<
  SessionSave,
  "id" | "fileUpdatedAt" | "machineName"
>;

export type RulerLane = {
  machine: string | null;
  /** Its states, oldest first. */
  states: RulerState[];
};

/**
 * Every save and commit of the loaded history as ruler states, oldest first
 * (ties by save id, so the order never wobbles). `title` words a state for the
 * viewer; the caller passes the formatter's date, so no zone is read here.
 */
export function rulerStates({
  commits,
  saves,
  describe,
}: {
  commits: readonly RulerCommit[];
  saves: readonly RulerSave[];
  /** How a state reads on hover: "message · author · 2 Oct 2026, 23:00". */
  describe: (
    state: Pick<RulerState, "kind" | "at" | "machine"> & {
      message?: string;
      author?: string | null;
    }
  ) => string;
}): RulerState[] {
  const states: RulerState[] = [];

  for (const save of saves) {
    const at = Date.parse(save.fileUpdatedAt);
    states.push({
      key: `save:${save.id}`,
      kind: "save",
      saveId: save.id,
      baselineSaveId: null,
      at,
      machine: save.machineName,
      rowId: saveRowId(save.id),
      title: describe({ kind: "save", at, machine: save.machineName }),
      commitId: null,
    });
  }

  for (const commit of commits) {
    const at = Date.parse(commit.committedAt);
    const kind = commit.kind === "checkpoint" ? "checkpoint" : "commit";
    states.push({
      key: `commit:${commit.id}`,
      kind,
      saveId: commit.saveId,
      baselineSaveId: commit.baselineSaveId,
      at,
      machine: commit.machineName,
      rowId: commitRowId(commit.id),
      title: describe({
        kind,
        at,
        machine: commit.machineName,
        message: commit.message,
        author: commit.authorName,
      }),
      commitId: commit.id,
    });
  }

  return states.sort((a, b) => a.at - b.at || a.saveId - b.saveId);
}

/**
 * The states by machine, busiest lane first (ties by name, an unnamed machine
 * last), each lane's states oldest first.
 */
export function lanesOf(states: readonly RulerState[]): RulerLane[] {
  const byMachine = new Map<string | null, RulerState[]>();
  for (const state of states) {
    const lane = byMachine.get(state.machine);
    if (lane) lane.push(state);
    else byMachine.set(state.machine, [state]);
  }
  return [...byMachine]
    .map(([machine, lane]) => ({ machine, states: lane }))
    .sort(
      (a, b) =>
        Number(a.machine === null) - Number(b.machine === null) ||
        b.states.length - a.states.length ||
        (a.machine ?? "").localeCompare(b.machine ?? "")
    );
}

/** The span the ruler covers: the oldest state to `now`, or to the newest state when that is later. */
export function rulerSpan(
  states: readonly RulerState[],
  now: number
): [number, number] {
  if (states.length === 0) return [now, now];
  const first = states[0]!.at;
  const last = states.reduce(
    (latest, state) => Math.max(latest, state.at),
    now
  );
  return [first, last];
}

/** Where a state stands along the ruler, as a percentage. */
export const placeOf = (state: RulerState, config: RulerConfig): number =>
  positionOf(state.at, config.min, config.max);

/**
 * The states a keyboard or a brush moves among: the commits when there are
 * any (checkpoints included), else every save. Oldest first.
 */
export function navigable(states: readonly RulerState[]): RulerState[] {
  const marks = states.filter((state) => state.kind !== "save");
  return marks.length > 0 ? marks : [...states];
}

/**
 * The states inside a brush from `a` to `b` (percentages along the ruler, either
 * way round), among the ones the ruler moves between.
 */
export function brushed(
  states: readonly RulerState[],
  config: RulerConfig,
  a: number,
  b: number,
  /** How far past either end a state still counts, in the same percentages: a mark has width. */
  pad = 0
): RulerState[] {
  const lo = Math.min(a, b) - pad;
  const hi = Math.max(a, b) + pad;
  return navigable(states).filter((state) => {
    const at = placeOf(state, config);
    return at >= lo && at <= hi;
  });
}

/** The two ends of a compare, as the history page's `?from=&to=` names them. */
export type Compare = { fromId: number | null; toId: number };

/**
 * A compare between two states: the older one's save as From and the newer's as
 * To, whichever order they were picked in. The same state twice, or two states
 * that stand for one save, compares that save with the one before it (`fromId`
 * its baseline where known, else null and the page chooses).
 */
export function compareOf(a: RulerState, b: RulerState): Compare {
  const [older, newer] =
    a.at < b.at || (a.at === b.at && a.saveId <= b.saveId) ? [a, b] : [b, a];
  if (older.saveId === newer.saveId) {
    return { fromId: newer.baselineSaveId, toId: newer.saveId };
  }
  return { fromId: older.saveId, toId: newer.saveId };
}

/** What a brush selects: the oldest and newest state in it compared, or nothing in an empty one. */
export function compareOfBrush(
  states: readonly RulerState[],
  config: RulerConfig,
  a: number,
  b: number,
  pad = 0
): Compare | null {
  const inside = brushed(states, config, a, b, pad);
  if (inside.length === 0) return null;
  return compareOf(inside[0]!, inside.at(-1)!);
}

/**
 * The state a key moves to from `current` among `states` (oldest first): `-1`
 * and `1` the previous and next, `"first"` and `"last"` the ends. Stays put at an
 * end. A `current` that is not among them lands on the newest.
 */
export function step(
  states: readonly RulerState[],
  current: string | null,
  move: -1 | 1 | "first" | "last"
): RulerState | null {
  if (states.length === 0) return null;
  const at = states.findIndex((state) => state.key === current);
  if (move === "first") return states[0]!;
  if (move === "last") return states.at(-1)!;
  if (at === -1) return states.at(-1)!;
  return states[Math.min(states.length - 1, Math.max(0, at + move))]!;
}
