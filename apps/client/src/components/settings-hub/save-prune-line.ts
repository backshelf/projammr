import type { AdminStorage } from "@workspace/api/api";
import type { Formatters } from "@workspace/ui/lib/formatters";

/**
 * The line under "Keep the content of uncommitted saves for": when the
 * retention job last ran and what it freed. Before the first run it says so,
 * and a failed run is named as one rather than showing a figure.
 */
export function savePruneLine(
  sweep: AdminStorage["lastSweep"],
  format: Pick<Formatters, "relative" | "bytes">
): string {
  if (!sweep?.finishedAt) return "Not pruned yet";
  const when = format.relative(sweep.finishedAt);
  if (sweep.status === "failed") return `Last prune failed ${when}`;
  return `Last pruned ${when} · ${format.bytes(sweep.bytesFreed, 0)} freed`;
}
