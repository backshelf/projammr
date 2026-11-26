import type { EntityModule } from "@/entities/types";

/** A project has no page of its own beyond the project root. */
export const project = {
  kind: "project",
  nouns: { singular: "project", plural: "projects" },
  hasStatus: false,
  customFieldKind: null,
  labelOf: (row) => row.name,
  pageRoute: () => ({ kind: "project" }),
  listRoute: null,
  newRoute: null,
  dropPrompt: "Drop files here",
} satisfies EntityModule<"project">;
