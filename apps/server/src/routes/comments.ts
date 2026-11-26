import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AuthedEnv } from "../auth.js";
import {
  commentWithRepliesSchema,
  commentWithUserSchema,
  type CommentWriter,
  createComment,
  deleteComment,
  getCommentsForTarget,
  reopenComment,
  resolveComment,
  updateComment,
} from "../db/queries/comments.js";
import { editCommentSchema, newCommentSchema } from "../db/schema/comments.js";
import { rawCommentTargetEnum } from "../db/schema/enums.js";
import { gatedRole } from "../middleware/authorize-project.js";
import {
  describer,
  idParam,
  idValue,
  params,
  respond,
  validator,
} from "../lib/http.js";
import { logComment } from "./activity-log.js";

const { describe, describeRaw } = describer("Comments");

const app = new Hono<AuthedEnv>();

const commentThreadSchema = z.array(commentWithRepliesSchema);

/** The caller as the comment queries see them: who they are and their role in the project. */
function commentActor(c: Context<AuthedEnv>): CommentWriter {
  return { userId: c.get("user").id, role: gatedRole(c) };
}

app.post(
  "/",
  describe(
    "Create a new comment",
    {
      status: 201,
      schema: commentWithUserSchema,
      description: "Comment created successfully",
    },
    400,
    404
  ),
  validator("json", newCommentSchema),
  async (c) => {
    // `authorizeProject` has already resolved and gated the target's project;
    // a target that belongs to no project is not something to discuss.
    const projectId = c.get("projectId");
    if (projectId == null) {
      throw new HTTPException(400, {
        message: "Cannot comment on an entity that belongs to no project",
      });
    }

    const comment = await createComment(
      c.req.valid("json"),
      commentActor(c),
      projectId
    );

    await logComment(c, comment, projectId);

    return respond(c, commentWithUserSchema, comment, 201);
  }
);

app.get(
  "/:targetType/:targetId",
  describe(
    "Get comments for an entity",
    {
      schema: commentThreadSchema,
      description: "Comments fetched successfully",
    },
    400
  ),
  params({
    targetType: z.enum(rawCommentTargetEnum),
    targetId: idValue,
  }),
  async (c) => {
    const { targetType, targetId } = c.req.valid("param");

    return respond(
      c,
      commentThreadSchema,
      await getCommentsForTarget(targetType, targetId, commentActor(c))
    );
  }
);

app.patch(
  "/:id",
  describe(
    "Partially update a comment",
    {
      schema: commentWithUserSchema,
      description: "Comment updated successfully",
    },
    400,
    403,
    404
  ),
  idParam(),
  validator("json", editCommentSchema.partial()),
  async (c) => {
    const { content } = c.req.valid("json");

    // Only the content is editable; a comment's target and author are fixed.
    const result = await updateComment(
      c.req.valid("param").id,
      { content },
      commentActor(c)
    );

    return respond(c, commentWithUserSchema, result);
  }
);

app.delete(
  "/:id",
  describeRaw(
    "Delete a comment",
    { status: 204, description: "Comment deleted" },
    400,
    403,
    404
  ),
  idParam(),
  async (c) => {
    await deleteComment(c.req.valid("param").id, c.get("user").id);

    return c.body(null, 204);
  }
);

app.post(
  "/:id/resolve",
  describe(
    "Resolve a comment",
    {
      schema: commentWithUserSchema,
      description: "Comment resolved; unchanged when it already was",
    },
    400,
    403,
    404
  ),
  idParam(),
  async (c) => {
    const { comment, changed } = await resolveComment(
      c.req.valid("param").id,
      commentActor(c)
    );

    if (changed) {
      await logComment(c, comment, c.get("projectId") ?? null, "resolved");
    }

    return respond(c, commentWithUserSchema, comment);
  }
);

app.delete(
  "/:id/resolve",
  describe(
    "Reopen a resolved comment",
    {
      schema: commentWithUserSchema,
      description: "Comment reopened; unchanged when it already was open",
    },
    400,
    403,
    404
  ),
  idParam(),
  async (c) => {
    const { comment, changed } = await reopenComment(
      c.req.valid("param").id,
      commentActor(c)
    );

    if (changed) {
      await logComment(c, comment, c.get("projectId") ?? null, "reopened");
    }

    return respond(c, commentWithUserSchema, comment);
  }
);

export default app;
