"use client";

import {
  createContext,
  use,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type CommandPaletteContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Opens the palette with `query` already typed, so it lands in the mode
   *  that query selects (a prefix command's, for instance). */
  openWith: (query: string) => void;
  /** What the palette starts with the next time it opens: empty for a plain
   *  open, the `openWith` query otherwise. */
  initialQuery: string;
};

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
  null
);

/**
 * Owns whether the command palette is open, outside the palette itself, so a
 * trigger elsewhere in the app (the sidebar's search affordance, the ⌘K
 * hotkey) can open it without becoming the palette's parent.
 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState({ open: false, initialQuery: "" });
  const setOpen = useCallback(
    (open: boolean) => setState({ open, initialQuery: "" }),
    []
  );
  const openWith = useCallback(
    (query: string) => setState({ open: true, initialQuery: query }),
    []
  );
  const value = useMemo(
    () => ({ ...state, setOpen, openWith }),
    [state, setOpen, openWith]
  );
  return (
    <CommandPaletteContext value={value}>{children}</CommandPaletteContext>
  );
}

export function useCommandPalette() {
  const context = use(CommandPaletteContext);
  if (!context) {
    throw new Error(
      "useCommandPalette must be used within a CommandPaletteProvider"
    );
  }
  return context;
}
