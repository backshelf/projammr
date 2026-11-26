import type { JSX } from "react";
import { IconDots } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { IconButton } from "@workspace/ui/components/icon-button";

import { BackfillItem } from "./backfill-item";
import { call, pickFolder } from "./bridge";
import { usePanelActions } from "./panel-actions";
import { UpdateItem } from "./update-offer";
import { describeFailure } from "./use-command";

/**
 * The `⋯` at the panel's head. Signed out there is nowhere to go but out, so the menu is Quit alone: the panel is
 * the only place the app can be quit from.
 */
export function PanelMenu({ signedIn }: { signedIn: boolean }): JSX.Element {
  const { go, report } = usePanelActions();

  /**
   * "Track a folder…": the system's folder picker, then the app's adopt offer for the folder it names, a folder that
   * was told "Not now" included. The offer is the home screen, so the panel goes there; a folder the app will not
   * offer comes back as a line at the top of the panel.
   */
  async function trackFolder(): Promise<void> {
    report(null);
    try {
      const folder = await pickFolder();
      if (folder === null) return;
      await call("track_folder", { folder });
      go("home");
    } catch (reason) {
      report(describeFailure(reason));
    }
  }

  async function signOut(): Promise<void> {
    report(null);
    try {
      await call("sign_out");
    } catch (reason) {
      report(describeFailure(reason));
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label="Menu">
          <IconDots />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {signedIn && (
          <>
            <DropdownMenuItem onClick={() => go("settings")}>
              Settings
              <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => go("repos")}>
              Repos
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void trackFolder()}>
              Track a folder…
            </DropdownMenuItem>
            <BackfillItem />
            <DropdownMenuItem onClick={() => void signOut()}>
              Sign out
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <UpdateItem />
        <DropdownMenuItem
          onClick={() => void call("quit")}
          className="flex-col items-start gap-0.5"
        >
          Quit
          <span className="text-micro text-pretty text-ink-soft">
            Scheduled work stops until dit is opened again.
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
