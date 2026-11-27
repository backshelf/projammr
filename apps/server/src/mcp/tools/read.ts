import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  getProjectMembers,
  projectMemberSchema,
} from "../../db/queries/authorization.js";
import {
  activityQuerySchema,
  getProjectActivity,
} from "../../db/queries/activity-feed.js";
import { activityWithUserSchema } from "../../db/queries/activity.js";
import {
  fieldListing,
  getCustomFields,
} from "../../db/queries/custom-fields.js";
import { customFieldSchema } from "../../db/schema/custom-fields.js";
import { getLabelsInProject } from "../../db/queries/labels.js";
import { labelSchema } from "../../db/schema/labels.js";
import { paginatedResponseSchema } from "../../db/queries/pagination.js";
import {
  getPriorityLevels,
  type ScaleEntry,
  scaleEntrySchema,
} from "../../db/queries/priority-levels.js";
import {
  ALL_SEARCH_TYPES,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  MAX_SEARCH_QUERY_LENGTH,
  searchProject,
  searchResultSchema,
  searchTypeSchema,
  type SearchType,
} from "../../db/queries/search.js";
import { getStatusesInProject } from "../../db/queries/statuses.js";
import {
  getRelationTypes,
  type RelationTypeEntry,
  relationTypeEntrySchema,
} from "../../db/queries/track-relation-types.js";
import { statusSchema } from "../../db/schema/statuses.js";
import {
  getProjectsForUser,
  projectsForUserSchema,
} from "../../db/queries/user.js";
import {
  getTracksInCollection,
  tracksInCollectionSchema,
} from "../../entities/collection/queries.js";
import { entityModules } from "../../entities/index.js";
import {
  getProject,
  projectDetailSchema as fullProjectDetailSchema,
  type ProjectDetail,
} from "../../entities/project/queries.js";
import {
  getTrackSessions,
  listTrackSchema,
  type ListTrack,
} from "../../entities/track/queries.js";
import { sessionSchema } from "../../db/schema/sessions.js";
import type { EntityList, EntityModule } from "../../entities/types.js";
import type { Actor } from "../actor.js";
import {
  resolveRelationFilterName,
  withRelationFilterName,
} from "../relation-type-names.js";
import { requireEntity, requireProject } from "../authorize.js";
import { defineTool } from "../spec.js";

/**
 * Every project the actor is a member of. No project gate: the query already
 * scopes to the actor's own memberships.
 */
export function listProjects(actor: Actor) {
  return getProjectsForUser(actor.id);
}

/** The vocabulary a caller needs before organising inside a project. */
export type ProjectMcpDetail = ProjectDetail & {
  statuses: Awaited<ReturnType<typeof getStatusesInProject>>;
  priorities: ScaleEntry[];
  relationTypes: RelationTypeEntry[];
  labels: Awaited<ReturnType<typeof getLabelsInProject>>;
  members: Awaited<ReturnType<typeof getProjectMembers>>;
  customFields: Awaited<ReturnType<typeof getCustomFields>>;
};

/**
 * One project's detail plus the vocabulary a caller needs before organising
 * inside it: its statuses, its priority scale, relation types, labels, members
 * and custom fields. Gated at viewer, so a caller outside the project gets a 404 (no
 * existence leak) and a member below viewer, if that ever exists, gets the
 * same 403 the HTTP route would answer.
 */
export async function getProjectDetail(
  actor: Actor,
  projectId: number
): Promise<ProjectMcpDetail> {
  await requireProject(actor, projectId, "viewer");
  const [
    project,
    statuses,
    priorities,
    relationTypes,
    labels,
    members,
    customFields,
  ] = await Promise.all([
    getProject(projectId),
    getStatusesInProject(projectId),
    getPriorityLevels(projectId),
    getRelationTypes(projectId),
    getLabelsInProject(projectId),
    getProjectMembers(projectId),
    getCustomFields(projectId),
  ]);
  return {
    ...project,
    statuses,
    priorities,
    relationTypes,
    labels,
    members,
    customFields,
  };
}

const listProjectsTool = defineTool({
  name: "list_projects",
  title: "List projects",
  description:
    "Every project the caller is a member of, each with its live track " +
    "count (`trackCount`), its archived track count (`archivedTrackCount`) " +
    "and the timestamp of its most recent activity.",
  scope: "read",
  idempotent: true,
  input: z.object({}),
  output: z.object({ projects: projectsForUserSchema }),
  run: async (actor) => ({ projects: await listProjects(actor) }),
});

const projectMcpDetailSchema = fullProjectDetailSchema
  .omit({ role: true })
  .extend({
    statuses: z.array(statusSchema),
    priorities: z.array(scaleEntrySchema),
    relationTypes: z.array(relationTypeEntrySchema),
    labels: z.array(labelSchema),
    members: z.array(projectMemberSchema),
    customFields: z.array(customFieldSchema),
  });

const getProjectTool = defineTool({
  name: "get_project",
  title: "Get project",
  description:
    "One project's detail, plus the vocabulary a caller needs before " +
    "organising inside it: its statuses, its priority scale (bottom level " +
    "first; the write tools name a level by its `name`), its relation types " +
    "(in list order; `add_track_relation` and `list_tracks` name a type by " +
    "its `name`), labels, members and custom fields. A track's or " +
    "collection's `fields` are keyed cf_<field id>.",
  scope: "read",
  idempotent: true,
  input: z.object({ projectId: z.number().int() }),
  output: projectMcpDetailSchema,
  run: (actor, { projectId }) => getProjectDetail(actor, projectId),
});

/** The entities with a project-scoped listing: collection, track, session. */
const listedModules = entityModules().filter(
  (m): m is EntityModule & { list: EntityList } => m.list != null
);

/**
 * Refuses a `sort` or `groupBy` the listing would not apply. REST resolves an
 * unrecognised value to the default rather than answering 400, because a stale
 * client URL should still load. An agent has no URL to go stale and no way to
 * see it happen, so here a wrong one is an error naming what the listing
 * takes, rather than a page that silently ignored what was asked for. The keys
 * are the built-in ones plus the project's own custom fields, which is why
 * they are checked per call rather than baked into the input schema.
 */
async function assertListKeys(
  module: EntityModule & { list: EntityList },
  projectId: number,
  query: { sort?: unknown; groupBy?: unknown }
) {
  const { list } = module;
  const fields = module.customFields
    ? await fieldListing(module.customFields, projectId, {})
    : undefined;
  const sortKeys = [...list.sortColumns, ...(fields?.sortKeys ?? [])];
  const groupKeys = [...list.groupColumns, ...(fields?.groupKeys ?? [])];

  if (typeof query.sort === "string") {
    const sorts = sortKeys.flatMap((key) => [`${key}.asc`, `${key}.desc`]);
    if (!sorts.includes(query.sort)) {
      throw new HTTPException(400, {
        message: `Unknown sort "${query.sort}"; sort takes one of: ${sorts.join(", ")}`,
      });
    }
  }
  if (typeof query.groupBy === "string" && !groupKeys.includes(query.groupBy)) {
    throw new HTTPException(400, {
      message:
        groupKeys.length > 0
          ? `Unknown groupBy "${query.groupBy}"; groupBy takes one of: ${groupKeys.join(", ")}`
          : `A ${module.label.toLowerCase()} listing does not group`,
    });
  }
}

/**
 * Slim track row returned by `list_tracks` when `compact: true`: flattens
 * nested status, collections, labels, and sessions into scalar ids, names,
 * flags, and counts so scanning a catalogue does not repeat nested objects.
 */
const compactTrackSchema = z.object({
  id: z.number(),
  title: z.string(),
  artists: z.array(z.string()),
  statusId: z.number().nullable(),
  statusName: z.string().nullable(),
  priorityId: z.number(),
  collectionIds: z.array(z.number()),
  labelNames: z.array(z.string()),
  releaseDate: z.string().nullable(),
  explicit: z.boolean(),
  hasNotes: z.boolean(),
  hasLyrics: z.boolean(),
  hasImage: z.boolean(),
  audioCount: z.number(),
  sessionCount: z.number(),
  archivedAt: z.date().nullable(),
  updatedAt: z.date(),
  trackNumber: z.number().nullable().optional(),
});

type CompactTrack = z.infer<typeof compactTrackSchema>;

function toCompactTrack(row: ListTrack): CompactTrack {
  return {
    id: row.id,
    title: row.title,
    artists: row.artists,
    statusId: row.statusId,
    statusName: row.status?.name ?? null,
    priorityId: row.priorityId,
    collectionIds: row.collections.map((c) => c.id),
    labelNames: row.labels.map((l) => l.name),
    releaseDate: row.releaseDate,
    explicit: row.explicit,
    hasNotes: row.hasNotes,
    hasLyrics: row.hasLyrics,
    hasImage: row.image != null,
    audioCount: row.audioCount,
    sessionCount: row.sessions.length,
    archivedAt: row.archivedAt,
    updatedAt: row.updatedAt,
    ...(row.trackNumber !== undefined ? { trackNumber: row.trackNumber } : {}),
  };
}

/**
 * `list_<kind>s` over any entity that declares a listing: the paginated page
 * its own `EntityList` already implements, gated at viewer, with a
 * description that enumerates the sort whitelist's own keys.
 */
function listTool(module: EntityModule & { list: EntityList }) {
  const { list } = module;
  const one = module.label.toLowerCase();
  const isTrack = module.kind === "track";

  const baseInput = z.object({
    projectId: z.number().int(),
    ...(isTrack
      ? {
          compact: z
            .boolean()
            .optional()
            .describe(
              "Return slim track rows (ids, names, flags, counts) instead of full nested status/labels/collections/sessions objects."
            ),
        }
      : {}),
  });
  const input = baseInput.and(withRelationFilterName(module, list.querySchema));
  const output = isTrack
    ? paginatedResponseSchema(z.union([listTrackSchema, compactTrackSchema]))
    : paginatedResponseSchema(list.rowSchema);

  const fieldKeys = module.customFields
    ? ", or cf_<id> for one of the project's custom fields (get_project lists them)"
    : "";
  const grouping =
    list.groupColumns.length > 0
      ? ` Group keys: ${list.groupColumns.join(", ")}` +
        (module.customFields
          ? ", or cf_<id> for a select or checkbox field"
          : "") +
        "."
      : "";
  const filtering = module.customFields
    ? " A custom field filters as cf_<id>: a number or date range " +
      '"<from>..<to>" (either end empty), select option ids comma-separated, ' +
      'a checkbox "true", "false" or "unset", a url "set" or "unset", and ' +
      "text by a substring."
    : "";
  const trackExtras = isTrack
    ? " Audit boolean filters: unlabeled, uncollected, hasNotes, hasLyrics, " +
      "hasImage, hasAudio, hasSessions. Pass compact: true for slim rows."
    : "";

  return defineTool({
    name: `list_${module.kind}s`,
    title: `List ${one}s`,
    description:
      `A filtered, sorted, paginated page of ${one}s in a project. ` +
      `Sort as "<key>.asc" or "<key>.desc"; keys: ${list.sortColumns.join(", ")}${fieldKeys}.` +
      grouping +
      filtering +
      trackExtras,
    scope: "read",
    idempotent: true,
    input,
    output,
    run: async (actor, rawInput) => {
      const { projectId, compact, ...query } = rawInput as {
        projectId: number;
        compact?: boolean;
      } & Record<string, unknown>;
      await requireProject(actor, projectId, "viewer");
      await assertListKeys(module, projectId, query);
      const page = await list.page(projectId, {
        projectId,
        ...(await resolveRelationFilterName(module, query, projectId)),
      });
      if (isTrack && compact) {
        return {
          ...page,
          rows: (page.rows as ListTrack[]).map(toCompactTrack),
        };
      }
      return page;
    },
  });
}

/**
 * `get_<kind>` over any entity with a listing (the project is served by
 * `get_project` instead): the entity's own detail load, merged with whatever
 * `mcpDetail` the module adds for an MCP caller specifically. When
 * `mcpDetail.replaces` names keys, `mcpDetail.schema` already describes the
 * whole merged output (the module states its own post-omit schema, since
 * omitting keys off a generic `ZodType` here would lose the literal key
 * types `.omit` needs); otherwise `mcpDetail.schema` is just the extra keys,
 * added onto the detail schema with `.and`.
 */
function getTool(module: EntityModule & { list: EntityList }) {
  const one = module.label.toLowerCase();
  const { mcpDetail } = module;
  const output = !mcpDetail
    ? module.schemas.detail
    : mcpDetail.replaces
      ? mcpDetail.schema
      : module.schemas.detail.and(mcpDetail.schema);

  return defineTool({
    name: `get_${module.kind}`,
    title: `Get ${one}`,
    description:
      mcpDetail?.description ??
      `One ${one}'s detail: relations, labels, artwork and the rest of what the app shows for it.`,
    scope: "read",
    idempotent: true,
    input: z.object({ id: z.number().int() }),
    output,
    run: async (actor, { id }) => {
      const gate = await requireEntity(actor, module.kind, id, "viewer");
      const detail = (await module.load(id, gate.role)) as Record<
        string,
        unknown
      >;
      for (const key of mcpDetail?.replaces ?? []) delete detail[key];
      const extra = mcpDetail ? await mcpDetail.read(id) : {};
      return { ...detail, ...extra } as z.infer<typeof output>;
    },
  });
}

const listCollectionTracksTool = defineTool({
  name: "list_collection_tracks",
  title: "List collection tracks",
  description: "Every track in a collection, in track-number order.",
  scope: "read",
  idempotent: true,
  input: z.object({ collectionId: z.number().int() }),
  output: z.object({ tracks: tracksInCollectionSchema }),
  run: async (actor, { collectionId }) => {
    await requireEntity(actor, "collection", collectionId, "viewer");
    return { tracks: await getTracksInCollection(collectionId) };
  },
});

/**
 * A track's session as `list_track_sessions` answers it: `structure` is
 * omitted unless `includeStructure: true` is passed so checking linked
 * sessions does not dump large DAW device trees into context.
 */
const trackSessionListItemSchema = sessionSchema.extend({
  structure: sessionSchema.shape.structure.optional(),
});

const listTrackSessionsTool = defineTool({
  name: "list_track_sessions",
  title: "List track sessions",
  description:
    "Every session belonging to a track, main session first, then most " +
    "recently updated. Omits DAW `structure` by default; pass " +
    "`includeStructure: true` or call `get_session` when you need it.",
  scope: "read",
  idempotent: true,
  input: z.object({
    trackId: z.number().int(),
    includeStructure: z
      .boolean()
      .optional()
      .describe(
        "Include each session's full DAW track/device tree (`structure`). Omitted by default."
      ),
  }),
  output: z.object({ sessions: z.array(trackSessionListItemSchema) }),
  run: async (actor, { trackId, includeStructure }) => {
    await requireEntity(actor, "track", trackId, "viewer");
    const rows = await getTrackSessions(trackId);
    if (includeStructure) return { sessions: rows };
    return {
      sessions: rows.map((row) => {
        const copy: Omit<typeof row, "structure"> & {
          structure?: typeof row.structure;
        } = { ...row };
        delete copy.structure;
        return copy;
      }),
    };
  },
});

const searchTool = defineTool({
  name: "search",
  title: "Search a project",
  description:
    "Trigram search over a project's tracks, collections, sessions and " +
    "assets, plus comments (surfaced as their parent entity). A query " +
    "under two characters answers no results.",
  scope: "read",
  idempotent: true,
  input: z.object({
    projectId: z.number().int(),
    q: z.string().trim().max(MAX_SEARCH_QUERY_LENGTH),
    types: z.array(searchTypeSchema).optional(),
    limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
  }),
  output: z.object({ results: z.array(searchResultSchema) }),
  run: async (actor, { projectId, q, types, limit }) => {
    await requireProject(actor, projectId, "viewer");
    if (!q) return { results: [] };
    const results = await searchProject(
      projectId,
      q,
      (types ?? ALL_SEARCH_TYPES) as SearchType[],
      limit ?? DEFAULT_SEARCH_LIMIT
    );
    return { results };
  },
});

const getActivityTool = defineTool({
  name: "get_activity",
  title: "Get project activity",
  description:
    "Recent activity in a project, newest first. Pass `entityType` + " +
    "`entityId` to scope it to one entity.",
  scope: "read",
  idempotent: true,
  input: activityQuerySchema.extend({ projectId: z.number().int() }),
  output: z.object({ activity: z.array(activityWithUserSchema) }),
  run: async (actor, { projectId, ...opts }) => {
    await requireProject(actor, projectId, "viewer");
    return { activity: await getProjectActivity(projectId, opts) };
  },
});

export const READ_TOOLS = [
  listProjectsTool,
  getProjectTool,
  ...listedModules.map(listTool),
  ...listedModules.map(getTool),
  listCollectionTracksTool,
  listTrackSessionsTool,
  searchTool,
  getActivityTool,
];
