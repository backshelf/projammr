import { Hono } from "hono";
import { z } from "zod";
import type { AuthedEnv } from "../auth.js";
import {
  checkStorage,
  storageCheckBodySchema,
  storageCheckSchema,
} from "../db/queries/objects.js";
import {
  repoSetSchema,
  adoptSet,
  adoptSetBodySchema,
  createOrGetRepo,
  getRepo,
  listRepos,
  listReposForCollection,
  listReposForTrack,
  newRepoSchema,
  patchRepoSchema,
  repoWithSetsSchema,
  setPushSamples,
} from "../db/queries/repos.js";
import {
  describer,
  errors,
  idParam,
  json,
  respond,
  validator,
} from "../lib/http.js";
import { gatedProject } from "../middleware/authorize-project.js";
import { logCreate } from "./activity-log.js";

const { describe, route } = describer("Repos");

const repoListSchema = z.array(repoWithSetsSchema);

/**
 * The repo routes that hang off a project's own mount. `mountEntities` has
 * already gated `/projects/*` on the project in the path, so these need no
 * resolver: a viewer lists, an editor creates.
 */
export function projectRepoRoutes(): Hono<AuthedEnv> {
  const app = new Hono<AuthedEnv>({ strict: false });

  app.post(
    "/:id/repos",
    route({
      description:
        "Create a repo in a project. A project holds one repo per name: " +
        "naming an existing repo returns it.",
      responses: {
        201: json(repoWithSetsSchema, "Repo created"),
        200: json(repoWithSetsSchema, "The repo of that name already existed"),
        ...errors(400, 403, 404),
      },
    }),
    idParam(),
    validator("json", newRepoSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const { name } = c.req.valid("json");
      const { repo, created } = await createOrGetRepo(
        id,
        name,
        c.get("user").id
      );
      return respond(c, repoWithSetsSchema, repo, created ? 201 : 200);
    }
  );

  app.get(
    "/:id/repos",
    describe(
      "List a project's repos. Each carries its adopted sets, with the " +
        "session that holds each.",
      { schema: repoListSchema, description: "The project's repos" },
      400,
      404
    ),
    idParam(),
    async (c) =>
      respond(c, repoListSchema, await listRepos(c.req.valid("param").id))
  );

  app.post(
    "/:id/repos/storage-check",
    describe(
      "Total the storage a folder's objects would add. This answers before " +
        "any repo exists. `bytes` is the sizes of those objects, " +
        "counted once each, that no repo of a project the caller is a " +
        "member of holds; `held` is how many such objects add nothing; " +
        "`remainingBytes` is the room the project and the caller have " +
        "left, null when neither has a cap. Nothing is linked or stored. " +
        "At most 10,000 objects a request.",
      { schema: storageCheckSchema, description: "What the objects would add" },
      400,
      403,
      404
    ),
    idParam(),
    validator("json", storageCheckBodySchema),
    async (c) =>
      respond(
        c,
        storageCheckSchema,
        await checkStorage(
          c.req.valid("param").id,
          c.get("user").id,
          c.req.valid("json").objects
        )
      )
  );

  return app;
}

/** What differs between the two entity mounts: the read and how a set is held. */
const ENTITY_REPO_LISTS = {
  track: {
    list: listReposForTrack,
    holder: "a session on the track",
  },
  collection: {
    list: listReposForCollection,
    holder: "a session on one of the collection's tracks",
  },
} as const;

/**
 * The repo lists that hang off a track's or a collection's own mount, which
 * `mountEntities` has already gated on the entity's project.
 */
export function entityRepoRoutes(
  kind: keyof typeof ENTITY_REPO_LISTS
): Hono<AuthedEnv> {
  const app = new Hono<AuthedEnv>({ strict: false });
  const { list, holder } = ENTITY_REPO_LISTS[kind];

  app.get(
    "/:id/repos",
    describe(
      `List the ${kind}'s repos. A repo qualifies when it holds a set whose ` +
        `session belongs to the ${kind}. ` +
        `Each carries all its sets, not only ${holder}.`,
      { schema: repoListSchema, description: `The ${kind}'s repos` },
      400,
      404
    ),
    idParam(),
    async (c) => respond(c, repoListSchema, await list(c.req.valid("param").id))
  );

  return app;
}

/**
 * The `/repos/:id` routes. `resolveRepoRoute` gates the mount on the repo's
 * project, so a repo the caller is not a member of answers 404.
 */
export function repoRoutes(): Hono<AuthedEnv> {
  const app = new Hono<AuthedEnv>({ strict: false });

  app.get(
    "/:id",
    describe(
      "Get a repo with its adopted sets",
      { schema: repoWithSetsSchema, description: "The repo" },
      400,
      404
    ),
    idParam(),
    async (c) =>
      respond(c, repoWithSetsSchema, await getRepo(c.req.valid("param").id))
  );

  app.patch(
    "/:id",
    describe(
      "Change a repo's push-samples switch. Editors only. While the " +
        "instance pushes samples from every repository the switch is locked " +
        "on and turning it off is refused with 409. Answers the repo.",
      { schema: repoWithSetsSchema, description: "The repo" },
      400,
      403,
      404,
      409
    ),
    idParam(),
    validator("json", patchRepoSchema),
    async (c) =>
      respond(
        c,
        repoWithSetsSchema,
        await setPushSamples(
          c.req.valid("param").id,
          c.req.valid("json").pushSamples
        )
      )
  );

  app.post(
    "/:id/sets",
    route({
      description:
        "Adopt a set into a repo. Links the named session of the project, or " +
        "creates one named after the file on the named track, and logs its " +
        "creation unless `quiet` is true. A set already adopted answers with " +
        "its session.",
      responses: {
        201: json(repoSetSchema, "A session was created for the set"),
        200: json(repoSetSchema, "The set is held by an existing session"),
        ...errors(400, 403, 404, 409),
      },
    }),
    idParam(),
    validator("json", adoptSetBodySchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const projectId = gatedProject(c);
      const userId = c.get("user").id;
      const body = c.req.valid("json");
      const { created, ...set } = await adoptSet(
        { id, projectId },
        userId,
        body
      );
      if (created && !body.quiet) {
        await logCreate(c, "session", projectId, set.sessionId);
      }
      return respond(c, repoSetSchema, set, created ? 201 : 200);
    }
  );

  return app;
}
