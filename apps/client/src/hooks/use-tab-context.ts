"use client";

import type { TabContext } from "@/components/dock/tabs";
import { useCurrentProjectId } from "@/components/dock/CurrentProjectProvider";
import { useCurrentRoute } from "@/hooks/use-current-route";
import { isSettingsPath, settingsProjectId } from "@/lib/settings/href";
import { isNotesPath } from "@/lib/utils";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

/**
 * The phone chrome's view of the current URL: the project in scope (the
 * route's own, else the `currentProject` cookie), the parsed route within a
 * project, and the raw pathname the Notes tab matches directly. In the
 * settings hub the project in scope is the one its Project section names,
 * else the cookie's. `null` outside `/project/:id`, `/notes` and `/settings`,
 * where the dock has nothing to show — `/profile`, `/`, `/invite/*`,
 * `/project/new`.
 */
export function useTabContext(): TabContext | null {
  const pathname = usePathname();
  const current = useCurrentRoute();
  const cookieProjectId = useCurrentProjectId();

  return useMemo(() => {
    if (current) {
      return { projectId: current.projectId, route: current.route, pathname };
    }

    if (isNotesPath(pathname)) {
      return { projectId: cookieProjectId, route: null, pathname };
    }

    if (isSettingsPath(pathname)) {
      return {
        projectId: settingsProjectId(pathname) ?? cookieProjectId,
        route: null,
        pathname,
      };
    }

    return null;
  }, [current, pathname, cookieProjectId]);
}
