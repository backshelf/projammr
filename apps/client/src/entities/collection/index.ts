import type { EntityModule } from "@/entities/types";

export const collection = {
  kind: "collection",
  nouns: { singular: "collection", plural: "collections" },
  hasStatus: true,
  customFieldKind: "collection",
  labelOf: (row) => row.title,
  pageRoute: (id) => ({ kind: "collection", collectionId: id }),
  listRoute: { kind: "collection-all" },
  newRoute: { kind: "collection-new" },
  dropPrompt: "Drop artwork proofs, masters or a tracklist",
} satisfies EntityModule<"collection">;
