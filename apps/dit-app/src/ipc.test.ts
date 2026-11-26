import { describe, expect, test } from "bun:test";

import fixture from "../fixtures/snapshot.json";
import {
  artUrl,
  type Clause,
  type RenderState,
  type RestoreState,
  type Snapshot,
  type StructureTrack,
  type UpdateState,
} from "./ipc";

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

// A key the fixture lacks, an extra one, or a value of the wrong shape fails the typecheck. Fields typed as a
// string union are held to `string`: their values are asserted below.
const wide = fixture satisfies Widen<Snapshot>;
wide satisfies Known<typeof fixture, Widen<Snapshot>>;

const AUTH: Snapshot["auth"]["state"][] = [
  "signed-out",
  "signing-in",
  "signed-in",
  "revoked",
  "keychain-locked",
];
const CONNECTION: Snapshot["connection"][] = [
  "online",
  "offline",
  "no-hub",
  "refused",
];

const CLAUSE_KINDS: Clause["kind"][] = [
  "tracks",
  "rename",
  "devices",
  "tempo",
  "timeSignature",
  "key",
  "clips",
  "scenes",
  "samples",
  "dawVersion",
  "trackEdit",
  "section",
  "sampleBytes",
  "more",
];
const RENDER_STATES: RenderState[] = [
  "waiting",
  "proposed",
  "uploading",
  "queued-offline",
  "added",
  "over-limit",
];
const RESTORE_STATES: RestoreState["state"][] = [
  "idle",
  "fetching",
  "writing",
  "opened",
  "failed",
];
const UPDATE_STATES: UpdateState["state"][] = [
  "none",
  "available",
  "installing",
  "failed",
];
const TRACK_KINDS: StructureTrack["kind"][] = [
  "audio",
  "midi",
  "return",
  "group",
  "master",
  "other",
];

describe("fixtures/snapshot.json", () => {
  test("carries every key of the Snapshot", () => {
    expect(Object.keys(fixture).sort()).toEqual(
      [
        "adoptOffer",
        "adopting",
        "artwork",
        "auth",
        "backfill",
        "barTitle",
        "clauses",
        "connection",
        "draft",
        "firstCommit",
        "headMeta",
        "lastCommit",
        "latestMeta",
        "live",
        "liveTracks",
        "machine",
        "notices",
        "open",
        "pendingRestore",
        "permissions",
        "push",
        "renders",
        "restore",
        "repos",
        "saves",
        "script",
        "settings",
        "timeSinceCommit",
        "trackProposal",
        "tracksChanged",
        "update",
      ].sort()
    );
  });

  test("holds members of the string unions", () => {
    expect(AUTH).toContain(fixture.auth.state as Snapshot["auth"]["state"]);
    expect(CONNECTION).toContain(fixture.connection as Snapshot["connection"]);
    expect(["script", "log", "title", "saves"]).toContain(fixture.open.signal);
    for (const render of fixture.renders) {
      expect(RENDER_STATES).toContain(render.state as RenderState);
    }
    expect(RESTORE_STATES).toContain(
      fixture.restore.state as RestoreState["state"]
    );
    expect(UPDATE_STATES).toContain(
      fixture.update.state as UpdateState["state"]
    );
    expect(["idle", "pushing", "waiting", "failed"]).toContain(
      fixture.push.state
    );
    expect([
      "not-installed",
      "installed",
      "connected",
      "live-not-found",
    ]).toContain(fixture.script.state);
    for (const set of fixture.adopting.sets) {
      expect(["saving", "saved"]).toContain(set.state);
    }
    for (const save of fixture.saves) {
      expect(["pending", "pushing", "pushed"]).toContain(save.push);
    }
    expect(["pending", "pushing", "pushed"]).toContain(fixture.lastCommit.push);
    for (const clause of fixture.clauses) {
      expect(CLAUSE_KINDS).toContain(clause.kind as Clause["kind"]);
    }
    for (const track of fixture.headMeta.structure.tracks) {
      expect(TRACK_KINDS).toContain(track.kind as StructureTrack["kind"]);
    }
  });

  test("pairs a head meta with a newer one the clauses and the changed tracks speak for", () => {
    const deviceNames = (
      meta: Snapshot["headMeta"],
      track: string
    ): string[] | undefined =>
      meta?.structure?.tracks.find((t) => t.name === track)?.devices;
    expect(
      deviceNames(fixture.latestMeta as Snapshot["latestMeta"], "Bass")
    ).toContain("EQ Eight");
    expect(
      deviceNames(fixture.headMeta as Snapshot["headMeta"], "Bass")
    ).not.toContain("EQ Eight");
    expect(fixture.tracksChanged).toEqual(["Bass"]);
    expect(fixture.clauses.map((clause) => clause.text)).toContain(
      "+EQ Eight on Bass"
    );
    const unreadable = fixture.saves.find((save) => save.unreadable);
    expect(unreadable?.meta).toBeNull();
  });
});

describe("artUrl", () => {
  test("is the hub's static path in the art scheme", () => {
    expect(artUrl("ab/cd/cover.png")).toBe(
      "dit-art://localhost/static/ab/cd/cover.png"
    );
    expect(artUrl("/ab/cover.png", 256)).toBe(
      "dit-art://localhost/static/ab/cover.png?w=256"
    );
  });

  test("encodes each segment so a name cannot add a path or a query", () => {
    expect(artUrl("a b/c?d#e.png")).toBe(
      "dit-art://localhost/static/a%20b/c%3Fd%23e.png"
    );
  });
});
