import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AuthedEnv } from "../auth.js";
import {
  assertLabelsInProject,
  bulkSetEntityLabels,
  bulkSetEntityLabelsSchema,
  setEntityLabels,
  setEntityLabelsSchema,
} from "../db/queries/labels.js";
import {
  bulkMoveSchema,
  type MovableKind,
  moveEntities,
  moveEntitySchema,
  movePreviewSchema,
  moveReportSchema,
  previewMove,
} from "../db/queries/move.js";
import {
  bulkDeletedSchema,
  bulkDeleteSchema,
  bulkSelectionSchema,
  paginatedResponseSchema,
} from "../db/queries/pagination.js";
import { assets } from "../db/schema/assets.js";
import { assertInProject } from "../db/queries/authorization.js";
import { isForeignKeyViolation } from "../db/unique-violation.js";
import { labelSchema } from "../db/schema/labels.js";
import { entityModules } from "../entities/index.js";
import { entityTag } from "../entities/shared.js";
import type { EntityModule } from "../entities/types.js";
import {
  describer,
  idParam,
  messageSchema,
  respond,
  respondMessage,
  validator,
} from "../lib/http.js";
import { log } from "../lib/log.js";
import { gatedProject, gatedRole } from "../middleware/authorize-project.js";
import { bulkMoveRateLimit } from "../middleware/rate-limit.js";
import {
  logArchives,
  logCreate,
  logDelete,
  logDeletes,
  logUpdate,
} from "./activity-log.js";

const logger = log("entities");

const labelsSchema = z.array(labelSchema);
const updatedCountSchema = z.object({ updated: z.number() });
const movedCountSchema = moveReportSchema.extend({ moved: z.number() });
const bulkArchiveSchema = bulkDeleteSchema;
const bulkArchivedSchema = z.object({
  ids: z
    .array(z.number().int())
    .describe(
      "The rows the call changed; rows already in the state are left out"
    ),
  sessionCount: z
    .number()
    .int()
    .describe("How many sessions belong to the rows that changed"),
});

/**
 * The `/bulk*` routes every listable entity has, mounted ahead of the
 * entity's own router (`routes/entities.ts`) rather than after it like
 * {@link genericRoutes}: every one of them is a literal path (`/bulk`,
 * `/bulk/move`), and an entity's own dynamic `/:id/move` would otherwise read
 * `bulk` as an id and 400 before this ever got a look in. Splitting it out
 * costs nothing for the routes that stay in `genericRoutes`: their shapes
 * don't collide with anything an entity router defines, which is why the
 * entity router could mount first for them in the first place.
 */
export function genericBulkRoutes(m: EntityModule): Hono<AuthedEnv> {
  const app = new Hono<AuthedEnv>();
  const { describe } = describer(entityTag(m));
  const one = m.label.toLowerCase();
  if (!m.list) return app;
  const { list } = m;

  app.patch(
    "/bulk",
    describe(
      `Apply one patch to many ${one}s. Select rows by \`ids\`, or by ` +
        "`all: true` plus the same filters the paginated list takes. " +
        "`projectId` scopes the write.",
      { schema: updatedCountSchema, description: `${m.label}s updated` },
      400,
      404
    ),
    validator(
      "json",
      z.object({
        projectId: z.coerce.number().int(),
        selection: bulkSelectionSchema,
        patch: list.patchSchema,
      })
    ),
    async (c) => {
      const { projectId, selection, patch } = c.req.valid("json");
      await m.assertWritable(patch, gatedProject(c));
      return respond(
        c,
        updatedCountSchema,
        await list.bulkUpdate(projectId, selection, patch, c.get("user").id)
      );
    }
  );

  app.delete(
    "/bulk",
    describe(
      `Delete many ${one}s. Select rows by \`ids\`, or by \`all: true\` ` +
        "plus the same filters the paginated list takes. Assets stay: they " +
        "belong to the project, not the row.",
      { schema: bulkDeletedSchema, description: `${m.label}s deleted` },
      400,
      404
    ),
    validator("json", bulkDeleteSchema),
    async (c) => {
      const projectId = gatedProject(c);
      const ids = await list.bulkDelete(
        projectId,
        c.req.valid("json").selection
      );
      await logDeletes(c, m.kind, projectId, ids);
      return respond(c, bulkDeletedSchema, { deleted: ids.length });
    }
  );

  if (m.move) {
    const kind = m.kind as MovableKind;

    app.on("POST", "/bulk/move", bulkMoveRateLimit);

    app.post(
      "/bulk/move",
      describe(
        `Move many ${one}s into another project. Select rows by \`ids\`, or ` +
          "by `all: true` plus the same filters the paginated list takes. " +
          "The caller must be an editor in both projects. Custom values the " +
          "target has no field for are listed in `droppedFields`. A priority " +
          "level the target's scale has no level of that name for becomes " +
          "the target's default, listed in `priorityFallbacks`.",
        { schema: movedCountSchema, description: `${m.label}s moved` },
        400,
        404
      ),
      validator("json", bulkMoveSchema),
      async (c) => {
        const { selection, targetProjectId } = c.req.valid("json");
        const sourceProjectId = gatedProject(c);
        const ids = await list.selectIds(sourceProjectId, selection);
        if (ids.length === 0) {
          return respond(c, movedCountSchema, {
            moved: 0,
            droppedFields: [],
            priorityFallbacks: [],
          });
        }

        const moved = await moveEntities(
          kind,
          ids,
          sourceProjectId,
          targetProjectId,
          c.get("user").id
        );
        return respond(c, movedCountSchema, {
          moved: moved.ids.length,
          droppedFields: moved.droppedFields,
          priorityFallbacks: moved.priorityFallbacks,
        });
      }
    );

    app.post(
      "/bulk/move/preview",
      describe(
        `Preview a bulk move of ${one}s. Answers the custom values moving ` +
          "them into another project would drop, without moving anything. " +
          "Takes the body `POST /bulk/move` takes and runs its checks.",
        { schema: movePreviewSchema, description: "Move previewed" },
        400,
        403,
        404
      ),
      validator("json", bulkMoveSchema),
      async (c) => {
        const { selection, targetProjectId } = c.req.valid("json");
        const sourceProjectId = gatedProject(c);
        const ids = await list.selectIds(sourceProjectId, selection);
        const droppedFields =
          ids.length === 0
            ? []
            : await previewMove(
                kind,
                ids,
                sourceProjectId,
                targetProjectId,
                c.get("user").id
              );
        return respond(c, movePreviewSchema, { droppedFields });
      }
    );
  }

  if (m.archive) {
    const { archive } = m;

    for (const [verb, archived] of [
      ["archive", true],
      ["unarchive", false],
    ] as const) {
      app.post(
        `/bulk/${verb}`,
        describe(
          `${archived ? "Archive" : "Unarchive"} many ${one}s. Select rows by ` +
            "`ids`, or by `all: true` plus the same filters the paginated " +
            "list takes. Rows already " +
            `${archived ? "archived" : "live"} are left alone and left out ` +
            "of the answer.",
          {
            schema: bulkArchivedSchema,
            description: `${m.label}s ${archived ? "archived" : "unarchived"}`,
          },
          400,
          404
        ),
        validator("json", bulkArchiveSchema),
        async (c) => {
          const projectId = gatedProject(c);
          const selected = await list.selectIds(
            projectId,
            c.req.valid("json").selection
          );
          const changed = await archive.set(selected, archived);
          await logArchives(
            c,
            m.kind,
            projectId,
            changed.ids,
            archived ? "archived" : "unarchived"
          );
          return respond(c, bulkArchivedSchema, changed);
        }
      );
    }
  }

  if (m.labels) {
    const target = m.labels;

    app.patch(
      "/bulk/labels",
      describe(
        `Add or remove labels across many ${one}s. Select rows by \`ids\`, ` +
          "or by `all: true` plus the same filters the paginated list " +
          "takes. Every other label a row carries is left alone.",
        { schema: updatedCountSchema, description: `${m.label}s updated` },
        400,
        404
      ),
      validator(
        "json",
        z
          .object({
            projectId: z.coerce.number().int(),
            selection: bulkSelectionSchema,
          })
          .extend(bulkSetEntityLabelsSchema.shape)
      ),
      async (c) => {
        const { selection, add, remove } = c.req.valid("json");
        const projectId = gatedProject(c);

        const overlap = add.filter((id) => remove.includes(id));
        if (overlap.length > 0) {
          throw new HTTPException(400, {
            message: "A label cannot be both added and removed",
          });
        }
        await assertLabelsInProject(projectId, [...add, ...remove]);

        const ids = await list.selectIds(projectId, selection);
        if (ids.length === 0) {
          return respond(c, updatedCountSchema, { updated: 0 });
        }

        const updated = await bulkSetEntityLabels(
          projectId,
          target,
          ids,
          { add, remove },
          c.get("user").id
        );
        return respond(c, updatedCountSchema, { updated });
      }
    );
  }

  return app;
}

/**
 * The routes every entity has, built from what its module declares. A kind
 * that gains a feature — labels, attachments, a project-scoped listing —
 * gains its routes by declaring it, not by having them written out again.
 * The `/bulk*` routes are {@link genericBulkRoutes}, mounted separately.
 */
export function genericRoutes(m: EntityModule): Hono<AuthedEnv> {
  const app = new Hono<AuthedEnv>();
  const { describe, describeRaw } = describer(entityTag(m));
  const one = m.label.toLowerCase();

  app.post(
    "/",
    describe(
      `Create a ${one}`,
      { status: 201, schema: m.schemas.row, description: `${m.label} created` },
      400,
      404,
      409
    ),
    validator("json", m.schemas.create),
    async (c) => {
      const data = c.req.valid("json");
      // A create that names no project is not scoped to one; `authorizeProject`
      // has already refused the case where it names another member's.
      const projectId = c.get("projectId");
      if (projectId != null) await m.assertWritable(data, projectId);

      const row = await m.create(data, { userId: c.get("user").id });
      logger.info(`created ${one}`, {
        id: row.id,
        projectId: m.projectIdOfRow(row),
      });
      await logCreate(c, m.kind, m.projectIdOfRow(row), row.id);
      return respond(c, m.schemas.row, row, 201);
    }
  );

  app.get(
    "/:id",
    describe(
      `Get a ${one}`,
      { schema: m.schemas.detail, description: `${m.label} fetched` },
      400,
      403,
      404
    ),
    idParam(),
    async (c) =>
      respond(
        c,
        m.schemas.detail,
        await m.load(c.req.valid("param").id, gatedRole(c))
      )
  );

  app.patch(
    "/:id",
    describe(
      `Partially update a ${one}`,
      { schema: m.schemas.row, description: `${m.label} updated` },
      400,
      404
    ),
    idParam(),
    validator("json", m.schemas.edit),
    async (c) => {
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json");
      await m.assertWritable(patch, gatedProject(c));

      const before = await m.row(id);
      const after = await m.update(id, patch);
      if (before)
        await logUpdate(
          c,
          m.kind,
          id,
          m.projectIdOfRow(after),
          before,
          after,
          m.activityIgnoredFields
        );
      return respond(c, m.schemas.row, after);
    }
  );

  const deleteDescription = `Delete a ${one}`;
  app.delete(
    "/:id",
    describeRaw(
      deleteDescription,
      { status: 204, description: `${m.label} deleted` },
      400,
      404
    ),
    idParam(),
    async (c) => {
      const deleted = await m.remove(c.req.valid("param").id);
      if (m.recordsDelete) {
        await logDelete(c, m.kind, m.projectIdOfRow(deleted), deleted.id);
      }
      return c.body(null, 204);
    }
  );

  if (m.labels) {
    const target = m.labels;
    app.put(
      "/:id/labels",
      describe(
        `Replace a ${one}'s full label set. \`labelIds\` reference existing ` +
          "project labels; `names` create (or reuse) labels in the project.",
        { schema: labelsSchema, description: "Labels set" },
        400,
        404
      ),
      idParam(),
      validator("json", setEntityLabelsSchema),
      async (c) =>
        respond(
          c,
          labelsSchema,
          await setEntityLabels(
            gatedProject(c),
            target,
            c.req.valid("param").id,
            c.req.valid("json"),
            c.get("user").id
          )
        )
    );
  }

  if (m.move) {
    const kind = m.kind as MovableKind;
    app.post(
      "/:id/move/preview",
      describe(
        `Preview moving a ${one}. Answers the custom values moving it into ` +
          "another project would drop, without moving it. Takes the body " +
          "`POST /:id/move` takes and runs its checks.",
        { schema: movePreviewSchema, description: "Move previewed" },
        400,
        403,
        404
      ),
      idParam(),
      validator("json", moveEntitySchema),
      async (c) =>
        respond(c, movePreviewSchema, {
          droppedFields: await previewMove(
            kind,
            [c.req.valid("param").id],
            gatedProject(c),
            c.req.valid("json").projectId,
            c.get("user").id
          ),
        })
    );
  }

  if (m.attachments?.link) {
    const { link } = m.attachments;
    app.post(
      "/:id/attachments",
      describe(
        `Attach an asset to a ${one}`,
        {
          status: 201,
          schema: messageSchema,
          description: "Asset attached successfully",
        },
        400,
        404,
        409
      ),
      idParam(),
      validator("json", z.object({ assetId: z.number() })),
      async (c) => {
        const { assetId } = c.req.valid("json");
        await assertInProject(assets, [assetId], gatedProject(c), "Asset");

        // A duplicate removal may delete the asset between the pre-check and
        // this insert; asking the pre-check again gives the answer it would
        // have had the removal committed first.
        const attached = await link(c.req.valid("param").id, assetId).catch(
          async (error: unknown) => {
            if (!isForeignKeyViolation(error)) throw error;
            await assertInProject(assets, [assetId], gatedProject(c), "Asset");
            throw error;
          }
        );
        if (!attached) {
          throw new HTTPException(409, {
            message: `Asset is already attached to this ${one}`,
          });
        }
        return respondMessage(c, "Attachment added", 201);
      }
    );
  }

  return app;
}

/**
 * The per-kind listings a project exposes, mounted under `/projects`. Every
 * entity that declares a listing gets both routes; the project itself has
 * none, because these are what it is the scope of.
 */
export function entityListRoutes(): Hono<AuthedEnv> {
  const app = new Hono<AuthedEnv>();

  for (const m of entityModules()) {
    if (!m.list) continue;
    const { list } = m;
    const { describe } = describer(entityTag(m));
    const one = m.label.toLowerCase();
    const pageSchema = paginatedResponseSchema(list.rowSchema);
    const summariesSchema = z.array(list.summarySchema);

    app.get(
      `/:id${m.mountPath}/paginated`,
      describe(
        `Get a page of a project's ${one}s. Filtered, sorted and ` +
          `paginated. Sort keys: ${list.sortColumns.join(", ")}.`,
        { schema: pageSchema, description: `${m.label} page fetched` },
        400
      ),
      idParam(),
      validator("query", list.querySchema),
      async (c) =>
        respond(
          c,
          pageSchema,
          await list.page(c.req.valid("param").id, c.req.valid("query"))
        )
    );

    app.get(
      `/:id${m.mountPath}/summary`,
      describe(
        `List a project's ${one} summaries. Every ${one} in the project, ` +
          "as the sidebar and pickers read it.",
        {
          schema: summariesSchema,
          description: `${m.label} summaries fetched`,
        },
        400
      ),
      idParam(),
      async (c) =>
        respond(
          c,
          summariesSchema,
          await list.summaries(c.req.valid("param").id)
        )
    );
  }

  return app;
}
