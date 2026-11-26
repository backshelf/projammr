import { describe, expect, test } from "bun:test";

import type {
  AdoptOffer,
  Adopting,
  AuthState,
  OpenSet,
  PendingRestore,
} from "./ipc";
import { isRestoring, screenOf, type Nav, type Screen } from "./screen";
import { base, signedIn } from "./test-support";

const offer = base.adoptOffer as AdoptOffer;
const open = base.open as OpenSet;
const adopting: Adopting = {
  folder: "/Users/me/Music/science Project",
  name: "science Project",
  setCount: 2,
  sets: [{ name: "science123", state: "saving" }],
};

describe("screenOf", () => {
  test.each<AuthState>([
    "signed-out",
    "signing-in",
    "revoked",
    "keychain-locked",
  ])("is the sign-in screen while %s, whatever was navigated to", (state) => {
    const snapshot = signedIn({
      auth: { state, host: null, pending: null },
      adoptOffer: offer,
    });
    for (const nav of ["home", "repos", "settings"] as const) {
      expect(screenOf(snapshot, nav).kind).toBe("sign-in");
    }
  });

  test("asks for another machine name once signed in, before anything else", () => {
    const snapshot = signedIn({
      machine: { name: null, refused: "Studio Mac" },
      adoptOffer: offer,
    });

    expect(screenOf(snapshot, "settings")).toEqual({
      kind: "machine-name",
      refused: "Studio Mac",
    });
  });

  const rows: {
    name: string;
    changes: Parameters<typeof signedIn>[0];
    nav: Nav;
    kind: Screen["kind"];
  }[] = [
    {
      name: "an offer to track the folder",
      changes: { adoptOffer: offer, open },
      nav: "home",
      kind: "adopt",
    },
    {
      name: "the adopt progress while a folder's sets are being saved, over the offer and the open set",
      changes: { adopting, adoptOffer: offer, open },
      nav: "home",
      kind: "adopting",
    },
    {
      name: "settings when asked for, over the adopt progress",
      changes: { adopting, open },
      nav: "settings",
      kind: "settings",
    },
    { name: "the open set", changes: { open }, nav: "home", kind: "set" },
    {
      name: "the repo list when nothing is open",
      changes: { open: null },
      nav: "home",
      kind: "repos",
    },
    {
      name: "the repo list when asked for, over the open set",
      changes: { open },
      nav: "repos",
      kind: "repos",
    },
    {
      name: "settings when asked for, over an offer",
      changes: { adoptOffer: offer, open },
      nav: "settings",
      kind: "settings",
    },
  ];

  test.each(rows)("is $name", ({ changes, nav, kind }) => {
    expect(screenOf(signedIn(changes), nav).kind).toBe(kind);
  });

  test("carries the offer and the open set it is about", () => {
    expect(screenOf(signedIn({ adoptOffer: offer }), "home")).toEqual({
      kind: "adopt",
      offer,
    });
    expect(screenOf(signedIn({ open }), "home")).toEqual({ kind: "set", open });
  });

  const pendingRestore: PendingRestore = {
    commitId: 4412,
    message: "added strings",
    set: "science",
    branch: "restore-a1b2c3d",
    problem: null,
  };

  test("is the restore screen once a restore link arrived, over the person's navigation, an offer and the open set", () => {
    for (const nav of ["home", "repos", "settings"] as const) {
      expect(
        screenOf(signedIn({ pendingRestore, adoptOffer: offer, open }), nav)
      ).toEqual({ kind: "restore", pending: pendingRestore });
    }
  });

  test("keeps sign-in and the machine name ahead of a restore link", () => {
    expect(
      screenOf(
        signedIn({
          pendingRestore,
          auth: { state: "revoked", host: null, pending: null },
        }),
        "home"
      ).kind
    ).toBe("sign-in");
    expect(
      screenOf(
        signedIn({
          pendingRestore,
          machine: { name: null, refused: "Studio Mac" },
        }),
        "home"
      ).kind
    ).toBe("machine-name");
  });

  test("goes back to the set once the link is let go", () => {
    expect(
      screenOf(signedIn({ pendingRestore: null, open }), "home").kind
    ).toBe("set");
  });
});

describe("isRestoring", () => {
  test("is true while the app fetches or writes, and no other time", () => {
    expect(isRestoring({ state: "fetching", objects: 0 })).toBe(true);
    expect(isRestoring({ state: "writing", file: "a.als" })).toBe(true);
    expect(isRestoring({ state: "idle" })).toBe(false);
    expect(isRestoring({ state: "opened", file: "a.als", note: null })).toBe(
      false
    );
    expect(
      isRestoring({
        state: "failed",
        message: "no",
        suggestion: null,
        existing: null,
      })
    ).toBe(false);
  });
});
