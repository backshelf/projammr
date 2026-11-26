import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { projectScope } from "../../db/queries/authorization.js";
import {
  getCommit,
  getSessionCommits,
  projectIdForCommit,
  sessionCommitSchema,
  stateRefSchema,
} from "../../db/queries/commits.js";
import { savesQuerySchema } from "../../db/queries/pagination.js";
import { diffStates, saveDiffSchema } from "../../lib/save-diff.js";
import { listRepos, repoWithSetsSchema } from "../../db/queries/repos.js";
import {
  requireEntity,
  requireProject,
  requireResolved,
} from "../authorize.js";
import { defineTool } from "../spec.js";

const listReposTool = defineTool({
  name: "list_repos",
  title: "List repos",
  description:
    "Every dit repo of a project, oldest first, each with the sets it has adopted: the session holding each and every branch with its tip commit.",
  scope: "read",
  idempotent: true,
  input: z.object({ projectId: z.number().int() }),
  output: z.object({ repos: z.array(repoWithSetsSchema) }),
  run: async (actor, { projectId }) => {
    await requireProject(actor, projectId, "viewer");
    return { repos: await listRepos(projectId) };
  },
});

const listCommitsTool = defineTool({
  name: "list_commits",
  title: "List session commits",
  description:
    "A session's dit commits, newest first, each with the saves it covers and `timeInSet`, the seconds the set was open across that window. " +
    "Pass `branch` to keep one branch's commits (an unknown branch answers none) and `since` (an ISO instant) to keep those committed after it.",
  scope: "read",
  idempotent: true,
  input: savesQuerySchema.extend({
    sessionId: z.number().int(),
    branch: z.string().optional(),
    since: z.iso.datetime({ offset: true }).optional(),
  }),
  output: z.object({ commits: z.array(sessionCommitSchema) }),
  run: async (actor, { sessionId, branch, since, limit }) => {
    await requireEntity(actor, "session", sessionId, "viewer");
    return {
      commits: await getSessionCommits(sessionId, limit, {
        branch,
        since: since === undefined ? undefined : new Date(since),
      }),
    };
  },
});

const getCommitTool = defineTool({
  name: "get_commit",
  title: "Get a commit",
  description:
    "One dit commit with every save it covers, each with its meta. Its `timeInSet` is the seconds the set was open across the window it covers, null when none.",
  scope: "read",
  idempotent: true,
  input: z.object({ id: z.number().int() }),
  output: sessionCommitSchema,
  run: async (actor, { id }) => {
    await requireResolved(
      actor,
      projectScope(await projectIdForCommit(id)),
      "commit",
      "viewer"
    );
    const commit = await getCommit(id);
    if (!commit) throw new HTTPException(404, { message: "commit not found" });
    return commit;
  },
});

const diffCommitsTool = defineTool({
  name: "diff_commits",
  title: "Diff two states of a session",
  description:
    "What changed between two states of a session, across branches, in the shape the web's diff draws " +
    "(chips, readouts, tracks, samples). `from` and `to` are `save:<id>` or `commit:<id>`; a commit stands for the save it names.",
  scope: "read",
  idempotent: true,
  input: z.object({
    sessionId: z.number().int(),
    from: stateRefSchema,
    to: stateRefSchema,
  }),
  output: saveDiffSchema,
  run: async (actor, { sessionId, from, to }) => {
    await requireEntity(actor, "session", sessionId, "viewer");
    return diffStates(sessionId, from, to);
  },
});

export const REPO_TOOLS = [
  listReposTool,
  listCommitsTool,
  getCommitTool,
  diffCommitsTool,
];
