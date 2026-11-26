"use client";

import { BottomSheet, SHEET_ROW } from "@/components/dock/BottomSheet";
import { AppLink } from "@/components/navigation/AppLink";
import {
  hrefFromParsedRoute,
  initials,
  mediaProxyUrl,
  NEW_PROJECT_HREF,
} from "@/lib/utils";
import { IconPlus, IconSelector } from "@tabler/icons-react";
import type { Project } from "@workspace/api/api";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import { SheetClose } from "@workspace/ui/components/sheet";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";

type ProjectSummary = Pick<Project, "id" | "name" | "image">;

export function ProjectSwitcherSheet({
  projects,
  currentProject,
}: {
  projects: ProjectSummary[];
  currentProject?: ProjectSummary;
}) {
  return (
    <BottomSheet
      title={"Switch project"}
      trigger={
        <button
          type={"button"}
          className={
            "flex min-h-11 min-w-0 items-center gap-1 text-small font-medium text-ink"
          }
        >
          <span className={cn("truncate", !currentProject && "text-ink-soft")}>
            {currentProject?.name ?? "Select a project"}
          </span>
          <IconSelector className={"size-4 shrink-0 text-ink-faint"} />
        </button>
      }
    >
      <p className={cn(LABEL, "px-4 py-2 text-ink-soft")}>Your projects</p>
      {projects.map((project) => {
        const current = project.id === currentProject?.id;
        return (
          <SheetClose asChild nativeButton={false} key={project.id}>
            <AppLink
              href={hrefFromParsedRoute({ kind: "project" }, project.id)}
              aria-current={current ? "true" : undefined}
              className={cn(SHEET_ROW, !current && "text-ink-soft")}
            >
              <Avatar className={"size-6 shrink-0"}>
                <AvatarImage src={mediaProxyUrl(project.image)} alt={""} />
                <AvatarFallback>{initials(project.name)}</AvatarFallback>
              </Avatar>
              <span className={"truncate"}>{project.name}</span>
            </AppLink>
          </SheetClose>
        );
      })}
      <SheetClose asChild nativeButton={false}>
        <AppLink href={NEW_PROJECT_HREF} className={SHEET_ROW}>
          <IconPlus className={"size-6 shrink-0 p-1 text-ink-faint"} />
          New project
        </AppLink>
      </SheetClose>
    </BottomSheet>
  );
}
