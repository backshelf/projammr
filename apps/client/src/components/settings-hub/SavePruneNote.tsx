import { getAdminStorage } from "@/actions/admin";
import { cachedFormatters } from "@/lib/formatters";
import { isActionError } from "@workspace/api/lib/action-result";
import { savePruneLine } from "./save-prune-line";

/** The retention setting's last-run line, read from the instance's storage readout. */
export async function SavePruneNote() {
  const [storage, format] = await Promise.all([
    getAdminStorage(),
    cachedFormatters(),
  ]);
  if (isActionError(storage)) return null;

  return (
    <p className="text-small text-ink-soft tabular-nums">
      {savePruneLine(storage.lastSweep, format)}
    </p>
  );
}
