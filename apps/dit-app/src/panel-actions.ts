import { createContext, use } from "react";

import type { Nav } from "./screen";

/** Where the person has navigated and how they move between the panel's screens: the panel's own state, never the app's. */
export type PanelActions = {
  nav: Nav;
  go: (to: Nav) => void;
  /** Out of a sub screen to the one the app's state names; a no-op at home. */
  back: () => void;
  /** Shows a line at the top of the panel for a command the menu ran and the app refused; null takes it away. */
  report: (line: string | null) => void;
};

const PanelActionsContext = createContext<PanelActions | null>(null);

export const PanelActionsProvider = PanelActionsContext.Provider;

export function usePanelActions(): PanelActions {
  const actions = use(PanelActionsContext);
  if (!actions) throw new Error("PanelActionsProvider is missing.");
  return actions;
}
