import { cn } from "@workspace/ui/lib/utils";
import { TopStrip } from "@/components/dock/TopStrip";
import { HomeProjectList } from "@/components/home/HomeProjectList";
import { AppLink } from "@/components/navigation/AppLink";
import { cachedMyProjects } from "@/lib/server-data";
import { NEW_PROJECT_HREF } from "@/lib/utils";
import { IconPlus, IconSquaresFilled } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { PageHead } from "@workspace/ui/components/layout/page-head";
import { PAGE } from "@workspace/ui/lib/shell";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ScrollRoot } from "@workspace/ui/components/layout/scroll-root";

export const metadata: Metadata = { title: "Projects" };

/** The member's projects; `proxy.ts` sends a signed-out reader to `/` first. */
export default async function Page() {
  const projects = await cachedMyProjects();

  return (
    <div className={"flex h-full min-h-0 flex-col"}>
      <Suspense fallback={<div className={"min-h-11 md:hidden"} aria-hidden />}>
        <TopStrip />
      </Suspense>
      {projects.length === 0 ? (
        <div
          className={
            "grid min-h-0 flex-1 place-items-center overflow-y-auto bg-paper-sunk p-(--gutter)"
          }
        >
          <div
            className={
              "flex w-full max-w-sm flex-col items-center gap-6 text-center"
            }
          >
            <IconSquaresFilled className={"size-7 text-ink-faint"} />
            <div>
              <h1 className={"font-heading text-subtitle/[1.1] text-ink"}>
                No project open
              </h1>
              <p className={cn("max-w-[34ch] text-body text-ink-soft", "mt-2")}>
                A project holds your collections, tracks and sessions.
              </p>
            </div>
            <Button asChild>
              <AppLink href={NEW_PROJECT_HREF}>
                <IconPlus />
                Create a project
              </AppLink>
            </Button>
          </div>
        </div>
      ) : (
        <div className={"min-h-0 flex-1"}>
          <ScrollRoot className={PAGE}>
            <PageHead
              title="Projects"
              action={
                <Button variant="ghost" asChild>
                  <AppLink href={NEW_PROJECT_HREF}>
                    <IconPlus />
                    Create a project
                  </AppLink>
                </Button>
              }
            />
            <HomeProjectList projects={projects} />
          </ScrollRoot>
        </div>
      )}
    </div>
  );
}
