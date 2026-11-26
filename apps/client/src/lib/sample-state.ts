import type { Session } from "@workspace/api/api";

/** What the Samples section says about one sample's bytes. */
export type SampleState =
  "on the hub" | "not pushed" | "outside the project folder" | "missing";

type Sample = Pick<
  NonNullable<Session["samples"]>[number],
  "kind" | "status" | "held"
>;

/**
 * A sample's state. "missing" is Live's own finding and wins. Only a set in a
 * dit repo has anything the hub could hold, so a session with no repo keeps
 * the rows from before dit as they were (null). Outside the project folder and
 * Ableton's library are never tracked; a project sample is on the hub when it
 * is held and not pushed otherwise.
 */
export function sampleState(
  sample: Sample,
  inRepo: boolean
): SampleState | null {
  if (sample.status === "missing") return "missing";
  if (!inRepo) return null;
  if (sample.kind !== "project") return "outside the project folder";
  return sample.held ? "on the hub" : "not pushed";
}

/** The one-file download of a held sample, or null when there is none. */
export function sampleDownloadHref(
  repoId: number | null | undefined,
  object: string | null | undefined
): string | null {
  return repoId != null && object
    ? `/api/samples/${object}?repo=${repoId}`
    : null;
}

/** The tooltip on "Download with samples": how many of the samples a commit's set references the zip holds. */
export function samplesIncluded(held: number, referenced: number): string {
  return `${held} of ${referenced} ${referenced === 1 ? "sample" : "samples"} included`;
}

/** Download with samples is offered only when the hub holds at least one. */
export const offersSamplesZip = (held: number): boolean => held > 0;
