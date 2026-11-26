import { useCallback, useState } from "react";

/** The line to show for why a command was refused: the app's own words (a string, or an error's message). */
export function describeFailure(reason: unknown): string {
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return reason.message;
  return "Something went wrong.";
}

export type CommandRun = {
  /** Awaits `command`; resolves to whether it was accepted, and keeps why not in `error`. */
  run: (command: () => Promise<unknown>) => Promise<boolean>;
  pending: boolean;
  /** Why the last command was refused; null once another is accepted or started. */
  error: string | null;
};

/** The state of the commands one control sends: whether one is in flight and the line for the last refusal. */
export function useCommand(): CommandRun {
  const [state, setState] = useState<{
    pending: boolean;
    error: string | null;
  }>({ pending: false, error: null });

  const run = useCallback(
    async (command: () => Promise<unknown>): Promise<boolean> => {
      setState({ pending: true, error: null });
      try {
        await command();
        setState({ pending: false, error: null });
        return true;
      } catch (reason) {
        setState({ pending: false, error: describeFailure(reason) });
        return false;
      }
    },
    []
  );

  return { run, pending: state.pending, error: state.error };
}
