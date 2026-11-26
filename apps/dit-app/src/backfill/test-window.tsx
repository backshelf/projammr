import type { ReactElement } from "react";
import { MotionProvider } from "@workspace/ui/components/motion-provider";

import type { BackfillView } from "../backfill-ipc";
import { BackfillWindow } from "./window";

/** The window on `view` with the providers the window's entry gives it. */
export function WindowOf({ view }: { view: BackfillView }): ReactElement {
  return (
    <MotionProvider>
      <BackfillWindow view={view} />
    </MotionProvider>
  );
}
