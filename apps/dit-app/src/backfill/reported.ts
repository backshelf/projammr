import { createContext, use } from "react";

const ReportedContext = createContext<string | null>(null);

/** Provides the window's refusal line (why a command was not taken) to the frame and the readout. */
export const ReportedProvider = ReportedContext.Provider;

/** The line for the last refusal, or null while there is none. */
export function useReported(): string | null {
  return use(ReportedContext);
}
