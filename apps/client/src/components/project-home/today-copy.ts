import { pluralizeCount } from "@workspace/session-diff/format";

/**
 * How the project's new window reads: "since yesterday" at 24 hours, "in the
 * last N days" at a whole number of days above that, else "in the last N hours".
 */
export function newWindowLabel(hours: number): string {
  if (hours === 24) return "since yesterday";
  if (hours === 1) return "in the last hour";
  if (hours % 24 === 0 && hours > 24) return `in the last ${hours / 24} days`;
  return `in the last ${hours} hours`;
}

/**
 * The masthead's one sentence: "3 renders and 5 saves since yesterday · 2 jobs
 * running · 4 tracks gone quiet". The window wording follows the project's
 * new-hours setting. A clause at zero is dropped, and with all of them at zero
 * it reads "nothing new since yesterday" in the same wording.
 */
export function todaySentence(counts: {
  renders: number;
  saves: number;
  running: number;
  quiet: number;
  newHours: number;
}): string {
  const window = newWindowLabel(counts.newHours);
  const landed = [
    counts.renders > 0 && pluralizeCount(counts.renders, "render"),
    counts.saves > 0 && pluralizeCount(counts.saves, "save"),
  ].filter(Boolean);

  const clauses = [
    landed.length > 0 && `${landed.join(" and ")} ${window}`,
    counts.running > 0 && `${pluralizeCount(counts.running, "job")} running`,
    counts.quiet > 0 && `${pluralizeCount(counts.quiet, "track")} gone quiet`,
  ].filter(Boolean);

  return clauses.length > 0 ? clauses.join(" · ") : `nothing new ${window}`;
}
