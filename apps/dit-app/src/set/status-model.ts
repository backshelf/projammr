import type { Snapshot } from "../ipc";

/** One line the set screen holds while a state lasts. */
export type StatusLine = {
  key: string;
  text: string;
  /** `problem` is in the danger ink and announced; the rest are information. */
  tone: "info" | "problem";
};

/** The hub's name as a person says it: "projammr.example" for "https://projammr.example". */
function hostOf(host: string | null): string {
  if (host === null) return "the hub";
  try {
    return new URL(host).host;
  } catch {
    return host;
  }
}

/** A sentence's closing stop, once: the hub's own words may end on one already. */
function stopped(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * What the snapshot says about the Live side of the set: Live is not running, so the skyline is the last save's; or
 * Live runs without dit's script, so nothing changes in the skyline before a save.
 */
export function liveLines(
  snapshot: Pick<Snapshot, "live" | "script">
): StatusLine[] {
  if (!snapshot.live) {
    return [{ key: "live", text: "Live isn't running.", tone: "info" }];
  }
  if (snapshot.script.state !== "connected") {
    return [
      {
        key: "script",
        text: "Live\u2019s dit script isn\u2019t enabled. Enable it in Live \u203a Settings \u203a Link, Tempo & MIDI for live changes.",
        tone: "info",
      },
    ];
  }
  return [];
}

/** What the snapshot says about getting the set to the hub: not signed in, unreachable, refused, or on its way. */
export function pushLines(
  snapshot: Pick<Snapshot, "auth" | "connection" | "push">
): StatusLine[] {
  const host = hostOf(snapshot.auth.host);
  if (snapshot.connection === "no-hub") {
    return [
      {
        key: "no-hub",
        text: "Not signed in.",
        tone: "info",
      },
    ];
  }
  if (snapshot.push.state === "failed") {
    const why =
      snapshot.push.message === null
        ? "."
        : `: ${stopped(snapshot.push.message)}`;
    return [
      {
        key: "refused",
        text: `${host} refused the push${why}`,
        tone: "problem",
      },
    ];
  }
  if (snapshot.connection === "offline") {
    return [
      {
        key: "offline",
        text: `Can\u2019t reach ${host}. Saves and commits are kept here and will push when it\u2019s back.`,
        tone: "info",
      },
    ];
  }
  if (snapshot.push.state === "pushing") {
    const { progress } = snapshot.push;
    const counted =
      progress !== null && progress.total > 1
        ? ` ${progress.done} of ${progress.total} repos`
        : "";
    return [
      {
        key: "pushing",
        text: `Pushing to ${host}\u2026${counted}`,
        tone: "info",
      },
    ];
  }
  return [];
}
