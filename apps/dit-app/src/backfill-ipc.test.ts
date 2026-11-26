import { describe, expect, test } from "bun:test";

import fixture from "../fixtures/backfill.json";
import {
  parseBackfillView,
  type BackfillCommands,
  type BackfillFolderState,
  type BackfillTarget,
  type BackfillView,
} from "./backfill-ipc";

/** The type a JSON import gives: every string literal is a `string`, so a union member cannot be checked by it. */
type Widen<T> = T extends string
  ? string
  : T extends readonly (infer E)[]
    ? Widen<E>[]
    : T extends object
      ? { [K in keyof T]: Widen<T[K]> }
      : T;

type ElementOf<T> = T extends readonly (infer E)[] ? E : never;

/** Every key any member of the union `S` has: a discriminated union's own keys count, not just the shared ones. */
type KeysOf<S> = S extends unknown ? keyof S : never;
type PropOf<S, K> = S extends unknown
  ? K extends keyof S
    ? S[K]
    : never
  : never;

/** `F` with every key `S` lacks turned into `never`: assigning the fixture to it fails on an extra key. */
type Known<F, S> = F extends readonly unknown[]
  ? Known<ElementOf<F>, ElementOf<NonNullable<S>>>[]
  : F extends object
    ? {
        [K in keyof F]: K extends KeysOf<NonNullable<S>>
          ? Known<F[K], PropOf<NonNullable<S>, K>>
          : never;
      }
    : F;

// A key the fixture lacks, an extra one, or a value of the wrong shape fails the typecheck.
const wide = fixture satisfies Widen<BackfillView>;
wide satisfies Known<typeof fixture, Widen<BackfillView>>;

// Ensure dead commands stay absent from the IPC command map.
// @ts-expect-error backfill_find is not a command
type NoBackfillFind = BackfillCommands["backfill_find"];
const _noBackfillFind: NoBackfillFind | undefined = undefined;
void _noBackfillFind;

const FOLDER_STATES: BackfillFolderState["state"][] = [
  "idle",
  "reading",
  "checked",
  "waiting",
  "committing",
  "uploading",
  "waiting-for-hub",
  "done",
  "paused",
  "failed",
];

const TARGET_KINDS: BackfillTarget["kind"][] = [
  "session",
  "track",
  "new-track",
];

describe("fixtures/backfill.json", () => {
  test("parses cleanly against the runtime BackfillView contract", () => {
    const view = parseBackfillView(fixture);

    expect(view).toEqual(fixture as unknown as BackfillView);
  });

  test("covers every BackfillFolderState, BackfillTarget and set doubt kind", () => {
    const view = parseBackfillView(fixture);
    const seenStates = new Set(
      view.folders.map((folder) => folder.state.state)
    );
    for (const state of FOLDER_STATES) {
      expect(seenStates.has(state)).toBe(true);
    }

    const seenTargets = new Set(
      view.chosen?.sets
        .map((set) => set.target?.kind)
        .filter((kind): kind is BackfillTarget["kind"] => kind !== undefined)
    );
    for (const kind of TARGET_KINDS) {
      expect(seenTargets.has(kind)).toBe(true);
    }

    const seenDoubts = new Set(
      view.chosen?.sets
        .map((set) => set.doubt?.kind)
        .filter(
          (kind): kind is "unreadable" | "unrecorded" => kind !== undefined
        )
    );
    expect(seenDoubts).toEqual(new Set(["unreadable", "unrecorded"]));
  });
});

describe("parseBackfillView", () => {
  test("rejects an unknown step", () => {
    expect(() => parseBackfillView({ ...fixture, step: "running" })).toThrow(
      "$.step"
    );
  });

  test("rejects missing or extra top-level keys", () => {
    const missing = Object.fromEntries(
      Object.entries(fixture).filter(([key]) => key !== "error")
    );
    expect(() => parseBackfillView(missing)).toThrow("expected keys");
    expect(() => parseBackfillView({ ...fixture, extra: true })).toThrow(
      "expected keys"
    );
  });

  test("rejects an unknown folder state or malformed variant payload", () => {
    const badState = {
      ...fixture,
      folders: [{ ...fixture.folders[0], state: { state: "unknown" } }],
    };
    expect(() => parseBackfillView(badState)).toThrow("$.folders[0].state");

    const badUploading = {
      ...fixture,
      folders: [
        {
          ...fixture.folders[0],
          state: { state: "uploading", sent: "3", of: 9 },
        },
      ],
    };
    expect(() => parseBackfillView(badUploading)).toThrow(
      "$.folders[0].state.sent"
    );
  });

  test("rejects an unknown target kind", () => {
    const badTarget = {
      ...fixture,
      chosen: {
        ...fixture.chosen,
        sets: [
          {
            ...fixture.chosen.sets[0],
            target: { kind: "project", id: 1 },
          },
        ],
      },
    };
    expect(() => parseBackfillView(badTarget)).toThrow(
      "$.chosen.sets[0].target.kind"
    );
  });
});
