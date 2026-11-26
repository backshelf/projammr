"use client";

import { roleSatisfies } from "@/lib/roles";
import type { MemberRole, Project } from "@workspace/api/api";
import { createContext, type ReactNode, use, useMemo } from "react";

type ProjectContextValue = {
  id: number;
  name: string;
  role: MemberRole;
  can: (minRole: MemberRole) => boolean;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({
  project,
  children,
}: {
  project: Pick<Project, "id" | "name" | "role">;
  children: ReactNode;
}) {
  const { id, name, role } = project;
  const value = useMemo<ProjectContextValue>(
    () => ({ id, name, role, can: (minRole) => roleSatisfies(role, minRole) }),
    [id, name, role]
  );

  return <ProjectContext value={value}>{children}</ProjectContext>;
}

/**
 * The signed-in user's role in the current project, with a `can(minRole)`
 * helper for gating write affordances. Cosmetic only — the server enforces
 * every rule independently. Returns `null` outside a project route.
 */
export function useProjectRole(): Pick<
  ProjectContextValue,
  "role" | "can"
> | null {
  return use(ProjectContext);
}

/**
 * Everything below the project layout: the project this URL is in.
 * Throws outside it.
 */
export function useProject(): ProjectContextValue {
  const project = use(ProjectContext);
  if (!project)
    throw new Error("useProject() was called outside a project route");
  return project;
}
