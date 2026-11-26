"use client";
import { setProjectCookie } from "@/actions/cookie";
import { shouldUpdateProjectCookie } from "@/components/auth/project-cookie";
import { startTransition, useEffect } from "react";

/**
 * Keeps the `currentProject` cookie in step with whichever project the route
 * is showing. Mounted once in the project layout, so it sees every
 * project-scoped page — including a deep link to a collection, track,
 * session or settings page that never renders the project root. It only
 * calls the action when the route disagrees with the cookie, so visiting a
 * project's own pages costs no extra round trip.
 */
export const ProjectCookieUpdater = ({
  projectId,
  cookieProjectId,
  children,
}: React.PropsWithChildren<{
  projectId: number;
  cookieProjectId: number;
}>) => {
  useEffect(() => {
    if (!shouldUpdateProjectCookie(cookieProjectId, projectId)) {
      return;
    }
    startTransition(async () => {
      await setProjectCookie(projectId);
    });
  }, [projectId, cookieProjectId]);

  return <>{children}</>;
};
