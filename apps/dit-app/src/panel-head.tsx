import type { JSX, ReactNode } from "react";
import { IconArrowLeft } from "@tabler/icons-react";
import { IconButton } from "@workspace/ui/components/icon-button";

import { usePanelActions } from "./panel-actions";
import { PanelMenu } from "./panel-menu";

/**
 * The head every plain screen shares: its title in the display face with the menu at the right edge, a way back
 * when the screen was navigated to, and an optional line under the title that says what state the screen is in.
 */
export function PanelHead({
  title,
  lede,
  signedIn = true,
  back = false,
  blocking = false,
}: {
  title: ReactNode;
  lede?: ReactNode;
  /** False on the screens before sign-in, where the menu offers Quit alone. */
  signedIn?: boolean;
  /** Whether the screen was navigated to and so has a screen to go back to. */
  back?: boolean;
  /** True on blocking screens (`machine-name`, `restore`), hiding unreachable navigation items in the menu. */
  blocking?: boolean;
}): JSX.Element {
  const actions = usePanelActions();

  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        {back && (
          <IconButton
            aria-label="Back"
            onClick={actions.back}
            className="-ml-1"
          >
            <IconArrowLeft />
          </IconButton>
        )}
        <h1 className="min-w-0 flex-1 font-heading text-subtitle/none tracking-[-0.01em] text-balance text-ink">
          {title}
        </h1>
        <PanelMenu signedIn={signedIn} blocking={blocking} />
      </div>
      {lede && <p className="text-small text-pretty text-ink-soft">{lede}</p>}
    </header>
  );
}
