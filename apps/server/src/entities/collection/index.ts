import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  withFieldValues,
  withFieldWrites,
} from "../../db/queries/custom-fields.js";
import { moveCollectionToProject } from "../../db/queries/move.js";
import { collectionImagePathSql } from "../../db/queries/artwork.js";
import { assertStatusUsable } from "../../db/queries/authorization.js";
import {
  assertLevelsInProject,
  type DefaultableLevel,
} from "../../db/queries/priority-levels.js";
import { collectionAttachments } from "../../db/schema/attachments.js";
import {
  collections,
  collectionSchema,
  editCollectionSchema,
  type NewCollection,
  newCollectionSchema,
} from "../../db/schema/collections.js";
import { defineEntity, defineList, projectIdOfScopedRow } from "../shared.js";
import type { AttachmentJoin } from "../types.js";
import { collectionFilterSchema } from "./filters.js";
import {
  bulkDeleteCollections,
  bulkUpdateCollections,
  collectionDetailSchema,
  collectionGroupColumns,
  collectionQuerySchema,
  collectionSortColumns,
  collectionSummarySchema,
  createCollection,
  deleteCollection,
  getCollection,
  getCollectionRow,
  getCollectionsPage,
  getCollectionSummaries,
  listCollectionSchema,
  selectCollectionIds,
  updateCollection,
  updateCollectionStatus,
} from "./queries.js";

const attachments: AttachmentJoin = {
  table: collectionAttachments,
  entityColumn: collectionAttachments.collectionId,
  assetColumn: collectionAttachments.assetId,
  link: async (collectionId, assetId) => {
    const [row] = await db
      .insert(collectionAttachments)
      .values({ collectionId, assetId })
      .onConflictDoNothing()
      .returning();
    return row;
  },
};

export const collection = defineEntity({
  kind: "collection",
  mountPath: "/collections",
  label: "Collection",
  table: collections,
  projectColumn: collections.projectId,
  nameColumn: collections.title,
  image: {
    set: async (id, assetPath) => {
      const [row] = await db
        .update(collections)
        .set({ image: assetPath })
        .where(eq(collections.id, id))
        .returning({ id: collections.id });
      return row != null;
    },
  },
  labels: "collection",
  customFields: "collection",
  status: {
    set: (id, statusId) => updateCollectionStatus(id, { statusId }),
  },
  priorityLevel: true,
  move: moveCollectionToProject,
  attachments,
  commentSearchImagePath: collectionImagePathSql(
    collections.image,
    collections.projectId
  ),
  schemas: {
    row: withFieldValues(collectionSchema).partial({ fields: true }),
    detail: collectionDetailSchema,
    create: withFieldWrites(newCollectionSchema),
    edit: withFieldWrites(editCollectionSchema.partial()),
  },
  load: getCollection,
  row: getCollectionRow,
  create: (data: DefaultableLevel<NewCollection>) => createCollection(data),
  update: (id, patch: Partial<NewCollection>) => updateCollection(id, patch),
  remove: deleteCollection,
  projectIdOfRow: projectIdOfScopedRow,
  assertWritable: async (body, projectId) => {
    await assertStatusUsable(body.statusId, projectId);
    await assertLevelsInProject([body.priorityId], projectId);
  },
  list: defineList({
    querySchema: collectionQuerySchema,
    filterParams: Object.keys(collectionFilterSchema.shape),
    sortColumns: Object.keys(collectionSortColumns),
    groupColumns: collectionGroupColumns,
    rowSchema: listCollectionSchema,
    summarySchema: collectionSummarySchema,
    patchSchema: withFieldWrites(editCollectionSchema.partial()),
    page: getCollectionsPage,
    summaries: getCollectionSummaries,
    bulkUpdate: (
      projectId,
      selection,
      patch: Partial<NewCollection>,
      actorId
    ) => bulkUpdateCollections(projectId, selection, patch, actorId),
    bulkDelete: bulkDeleteCollections,
    selectIds: selectCollectionIds,
  }),
});
