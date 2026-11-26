import type {
  AdoptOffer,
  Adopting,
  OpenSet,
  PendingRestore,
  RestoreState,
  Snapshot,
} from "./ipc";

/** A restore that is running: fetching or writing. */
export type RunningRestore = Extract<
  RestoreState,
  { state: "fetching" | "writing" }
>;

/** Whether a restore is running: the app writes the branch's file whatever the screen does from here on. */
export function isRestoring(restore: RestoreState): restore is RunningRestore {
  return restore.state === "fetching" || restore.state === "writing";
}

/** Where the person has navigated to; `home` is whatever the app's state says the panel is for. */
export type Nav = "home" | "repos" | "settings";

/** The one screen the panel shows, with the part of the snapshot it is about. */
export type Screen =
  | { kind: "sign-in" }
  | { kind: "machine-name"; refused: string }
  | { kind: "adopt"; offer: AdoptOffer }
  | { kind: "adopting"; adopting: Adopting }
  | { kind: "restore"; pending: PendingRestore }
  | { kind: "set"; open: OpenSet }
  | { kind: "repos" }
  | { kind: "settings" };

/**
 * The screen for a snapshot and where the person has navigated. Signing in and naming the machine come first:
 * nothing else works without them. A restore link that arrived comes next, over whatever the person was looking at,
 * because they followed it from the web to see it. Past those the person's own navigation wins, and `home` falls to
 * what the app has: the sets of a folder being tracked as their first saves land, an offer to track the open set's
 * folder, the open set, or the repo list when nothing is open.
 */
export function screenOf(snapshot: Snapshot, nav: Nav): Screen {
  if (snapshot.auth.state !== "signed-in") return { kind: "sign-in" };
  if (snapshot.machine.refused !== null) {
    return { kind: "machine-name", refused: snapshot.machine.refused };
  }
  if (snapshot.pendingRestore) {
    return { kind: "restore", pending: snapshot.pendingRestore };
  }
  if (nav !== "home") return { kind: nav };
  if (snapshot.adopting) {
    return { kind: "adopting", adopting: snapshot.adopting };
  }
  if (snapshot.adoptOffer) return { kind: "adopt", offer: snapshot.adoptOffer };
  if (snapshot.open) return { kind: "set", open: snapshot.open };
  return { kind: "repos" };
}
