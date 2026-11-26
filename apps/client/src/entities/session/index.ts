import type { EntityModule } from "@/entities/types";

export const session = {
  kind: "session",
  nouns: { singular: "session", plural: "sessions" },
  hasStatus: false,
  customFieldKind: null,
  labelOf: (row) => row.name,
  pageRoute: (id, parents) => ({
    kind: "session",
    sessionId: id,
    trackId: parents.trackId,
    collectionId: parents.collectionId,
  }),
  listRoute: { kind: "session-all" },
  newRoute: { kind: "session-new" },
  dropPrompt: "Drop a bounce or an export from this session",
} satisfies EntityModule<"session">;
