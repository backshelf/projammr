import { createContext, use, type JSX } from "react";
import { DropdownMenuItem } from "@workspace/ui/components/dropdown-menu";

import { call } from "./bridge";
import type { UpdateState } from "./ipc";
import { usePanelActions } from "./panel-actions";
import { describeFailure } from "./use-command";

const NO_UPDATE: UpdateState = { state: "none" };

const UpdateContext = createContext<UpdateState>(NO_UPDATE);

/** What the app says of a newer release, for the menu on whichever screen is showing. Without one, there is none. */
export const UpdateProvider = UpdateContext.Provider;

/**
 * The menu's offer of a newer release: "Update to 0.10.0", the failure line under it when the last try failed, and
 * "Updating…" (not to be chosen again) from the click until the app relaunches. Nothing when there is no newer release.
 */
export function UpdateItem(): JSX.Element | null {
  const update = use(UpdateContext);
  const { report } = usePanelActions();

  if (update.state === "none") return null;
  if (update.state === "installing") {
    return <DropdownMenuItem disabled>Updating…</DropdownMenuItem>;
  }

  async function install(): Promise<void> {
    report(null);
    try {
      await call("install_update");
    } catch (reason) {
      report(describeFailure(reason));
    }
  }

  return (
    <DropdownMenuItem
      onClick={() => void install()}
      className="flex-col items-start gap-0.5"
    >
      Update to {update.version}
      {update.state === "failed" && (
        <span className="text-micro text-pretty text-danger">
          {update.message}
        </span>
      )}
    </DropdownMenuItem>
  );
}
