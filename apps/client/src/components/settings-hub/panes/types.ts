import type { MemberRole, Project } from "@workspace/api/api";
import type { SettingSection } from "@workspace/settings";
import type { ReactNode } from "react";

/** The project a Project section page is for, and the caller's role in it. */
export type HubProject = Pick<Project, "id" | "name" | "role">;

export type HubPaneProps = {
  /** The project a Project pane is for; `null` in every other section. */
  project: HubProject | null;
  /** The page's query string, for a pane that pages or filters. */
  searchParams: Record<string, string | string[] | undefined>;
};

/**
 * A whole component a section shows as one of its pages, beside the groups
 * the registry declares: a list editor, a table, a form of its own. It is
 * listed in its section's nav with the groups and has its own URL,
 * `/settings/<section>/<id>` (the project's id before it in the Project
 * section).
 */
export type HubPane = {
  /** The pane's URL segment; unique among its section's groups and panes. */
  id: string;
  section: SettingSection;
  label: string;
  /** Sorts the pane among its section's groups and panes, lowest first; ties by id. */
  order: number;
  /** The lowest project role that sees the pane. Counts in the Project section only. */
  minRole?: MemberRole;
  /** A server component; it loads its own data. */
  Content: (props: HubPaneProps) => ReactNode | Promise<ReactNode>;
};
