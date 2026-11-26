"use client";

import { createContext, use, type ReactNode } from "react";

const CurrentProjectIdContext = createContext<number | null>(null);

/**
 * Makes the `currentProject` cookie's id reachable from anywhere under the
 * dock, so a project-scoped tab can still resolve an `href` while the route
 * itself carries no project id — on `/notes`, chiefly. `Dock` is the only
 * provider; it reads the cookie server-side and passes it down as a prop.
 */
export function CurrentProjectProvider({
  currentProjectId,
  children,
}: {
  currentProjectId: number | null;
  children: ReactNode;
}) {
  return (
    <CurrentProjectIdContext value={currentProjectId}>
      {children}
    </CurrentProjectIdContext>
  );
}

export function useCurrentProjectId(): number | null {
  return use(CurrentProjectIdContext);
}
