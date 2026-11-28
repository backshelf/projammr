import { createContext, use } from "react";

import type { BackfillStanding, UpdateState } from "./ipc";
import type { Nav, Screen } from "./screen";

export type SettingsTab = "general" | "bounces" | "live";

const BackfillContext = createContext<BackfillStanding | null>(null);
export const BackfillProvider = BackfillContext.Provider;

export function useBackfillStanding(): BackfillStanding | null {
  return use(BackfillContext);
}

const NO_UPDATE: UpdateState = { state: "none" };
const UpdateContext = createContext<UpdateState>(NO_UPDATE);
export const UpdateProvider = UpdateContext.Provider;

export function useUpdateState(): UpdateState {
  return use(UpdateContext);
}

/** Where the person has navigated and how they move between the panel's screens: the panel's own state, never the app's. */
export type PanelActions = {
  nav: Nav;
  screen?: Screen["kind"];
  settingsTab?: SettingsTab;
  go: (to: Nav, settingsTab?: SettingsTab) => void;
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

export function useOptionalPanelActions(): PanelActions | null {
  return use(PanelActionsContext);
}
