import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AuthedEnv } from "../auth.js";
import {
  commitsPushedSchema,
  getSessionBranches,
  getSessionCommits,
  pushCommitsBodySchema,
  pushSavesBodySchema,
  recordCommits,
  recordSaves,
  savesPushedSchema,
  sessionBranchSchema,
  sessionCommitSchema,
  stateRefSchema,
} from "../db/queries/commits.js";
import { savesQuerySchema } from "../db/queries/pagination.js";
import { sessionOfSet } from "../db/queries/repos.js";
import {
  pushSegmentsBodySchema,
  recordSegments,
  segmentsPushedSchema,
} from "../db/queries/segments.js";
import { diffStates, saveDiffSchema } from "../lib/save-diff.js";
import {
  describer,
  errors,
  idParam,
  json,
  respond,
  validator,
} from "../lib/http.js";
import { pushMachine } from "../lib/push-machine.js";

const { describe, route } = describer("Repos");

const sessionBranchesSchema = z.array(sessionBranchSchema);
const sessionCommitsSchema = z.array(sessionCommitSchema);

const commitsQuerySchema = savesQuerySchema.extend({
  /** Keeps the commits on the branch of this name. */
  branch: z.string().optional(),
});

const diffQuerySchema = z.object({
  /** `save:<id>` or `commit:<id>`: a commit stands for the save it names. */
  from: stateRefSchema,
  to: stateRefSchema,
});

/** The session holding a set of the repo; a set nobody adopted is not there. */
async function setSession(repoId: number, ditSetId: string): Promise<number> {
  const sessionId = await sessionOfSet(repoId, ditSetId);
  if (sessionId == null) {
    throw new HTTPException(404, { message: "Set not adopted in this repo" });
  }
  return sessionId;
}

/**
 * What dit pushes to a repo. `resolveRepoRoute` gates the `/repos` mount on the
 * repo's project: an editor pushes, and a repo of a project the caller is not a
 * member of answers 404.
 */
export function repoHistoryRoutes(): Hono<AuthedEnv> {
  const app = new Hono<AuthedEnv>({ strict: false });

  app.post(
    "/:id/saves",
    describe(
      "Record the saves dit made on a branch of a set. A save already " +
        "recorded has its metadata refreshed; a save recorded at " +
        "the same time without content is given the content. The first " +
        "mention of a branch creates it. The `X-Machine-Id` header names the " +
        "pushing machine, which a save naming that machine's name takes as its " +
        "own: a 409 `machine_not_registered` when no machine holds the id, a " +
        "401 when it was removed.",
      { schema: savesPushedSchema, description: "Saves recorded" },
      400,
      401,
      403,
      404,
      409
    ),
    idParam(),
    validator("json", pushSavesBodySchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const sessionId = await setSession(id, body.ditSetId);
      const machine = await pushMachine(c.req.raw.headers, c.get("user").id);
      const saved = await recordSaves({
        repoId: id,
        sessionId,
        machine,
        branch: body.branch,
        saves: body.saves,
        localPath: body.localPath,
        localFilepath: body.localFilepath,
      });
      return respond(c, savesPushedSchema, { saved });
    }
  );

  app.post(
    "/:id/segments",
    describe(
      "Record the spans of time a set was open. A span pushed again keeps its " +
        "start and takes the later of its ends, so a re-push counts once. The " +
        "`X-Machine-Id` header names the pushing machine, as for saves.",
      { schema: segmentsPushedSchema, description: "Segments recorded" },
      400,
      401,
      403,
      404,
      409
    ),
    idParam(),
    validator("json", pushSegmentsBodySchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const sessionId = await setSession(id, body.ditSetId);
      const machine = await pushMachine(c.req.raw.headers, c.get("user").id);
      const recorded = await recordSegments({
        sessionId,
        machine,
        segments: body.segments,
      });
      return respond(c, segmentsPushedSchema, { recorded });
    }
  );

  app.post(
    "/:id/commits",
    route({
      description:
        "Record commits on a branch of a set, in order. Each continues the " +
        "branch head, names saves already recorded and objects the repo " +
        "holds, and marks those saves' content stored. A commit the repo " +
        "already has changes nothing. The `X-Machine-Id` header names the " +
        "pushing machine, as for saves.",
      responses: {
        201: json(commitsPushedSchema, "Commits recorded"),
        200: json(commitsPushedSchema, "Every commit was already recorded"),
        ...errors(400, 401, 403, 404, 409),
      },
    }),
    idParam(),
    validator("json", pushCommitsBodySchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const userId = c.get("user").id;
      const sessionId = await setSession(id, body.ditSetId);
      const machine = await pushMachine(c.req.raw.headers, userId);
      const inserted = await recordCommits({
        repoId: id,
        sessionId,
        userId,
        machine,
        branch: body.branch,
        commits: body.commits,
      });
      return respond(
        c,
        commitsPushedSchema,
        { inserted },
        inserted > 0 ? 201 : 200
      );
    }
  );

  return app;
}

/**
 * A session's dit history. The session entity's mount has already gated
 * `/sessions/*` on the session in the path, so a viewer reads.
 */
export function sessionHistoryRoutes(): Hono<AuthedEnv> {
  const app = new Hono<AuthedEnv>({ strict: false });

  app.get(
    "/:id/branches",
    describe(
      "A session's branches, each with the hash of its head commit.",
      { schema: sessionBranchesSchema, description: "Branches fetched" },
      400,
      404
    ),
    idParam(),
    async (c) =>
      respond(
        c,
        sessionBranchesSchema,
        await getSessionBranches(c.req.valid("param").id)
      )
  );

  app.get(
    "/:id/commits",
    describe(
      "A session's commits, newest first. Each carries the saves it covers, " +
        "its author's name and its sample counts. `branch` keeps one branch's " +
        "commits; `limit` takes up to 500.",
      { schema: sessionCommitsSchema, description: "Commits fetched" },
      400,
      404
    ),
    idParam(),
    validator("query", commitsQuerySchema),
    async (c) => {
      const { limit, branch } = c.req.valid("query");
      return respond(
        c,
        sessionCommitsSchema,
        await getSessionCommits(c.req.valid("param").id, limit, { branch })
      );
    }
  );

  app.get(
    "/:id/diff",
    describe(
      "Diff two states of a session. What changed between them, across " +
        "branches: each of `from` and `to` is `save:<id>` or `commit:<id>` (a commit stands " +
        "for the save it names). The answer is the diff the web draws, with " +
        "`from` and `to` as save ids. A reference outside the session is a " +
        "404; a save with no recorded metadata a 409.",
      { schema: saveDiffSchema, description: "Diff computed" },
      400,
      404,
      409
    ),
    idParam(),
    validator("query", diffQuerySchema),
    async (c) => {
      const { from, to } = c.req.valid("query");
      return respond(
        c,
        saveDiffSchema,
        await diffStates(c.req.valid("param").id, from, to)
      );
    }
  );

  return app;
}
