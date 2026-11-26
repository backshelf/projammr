import { call } from "./bridge";
import { usePanelActions } from "./panel-actions";
import { describeFailure } from "./use-command";

/**
 * Opens the backfill window, or brings it forward on the run there is. A refusal comes back as the line at the top of
 * the panel, as every other command's does.
 */
export function useOpenBackfill(): () => Promise<void> {
  const { report } = usePanelActions();
  return async () => {
    report(null);
    try {
      await call("open_backfill");
    } catch (reason) {
      report(describeFailure(reason));
    }
  };
}
