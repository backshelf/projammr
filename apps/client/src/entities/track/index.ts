import type { EntityModule } from "@/entities/types";

export const track = {
  kind: "track",
  nouns: { singular: "track", plural: "tracks" },
  hasStatus: true,
  customFieldKind: "track",
  labelOf: (row) => row.title,
  pageRoute: (id, parents) => ({
    kind: "track",
    trackId: id,
    collectionId: parents.collectionId,
  }),
  listRoute: { kind: "track-all" },
  newRoute: { kind: "track-new" },
  dropPrompt: "Drop a bounce, stems or a reference",
} satisfies EntityModule<"track">;
