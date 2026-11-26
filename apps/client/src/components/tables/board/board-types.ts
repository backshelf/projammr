import type { PriorityLevel } from "@workspace/api/api";

/** What a board card renders — the projection of a row onto a kanban face. */
export type BoardCardData = {
  id: number;
  title: string;
  subtitle?: string;
  image?: string | null;
  priority?: PriorityLevel;
  archived?: boolean;
};
