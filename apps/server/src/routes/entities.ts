import type { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import type { AuthedEnv, AuthType } from "../auth.js";
import { entityModules } from "../entities/index.js";
import collectionRoutes from "../entities/collection/routes.js";
import projectRoutes from "../entities/project/routes.js";
import sessionRoutes from "../entities/session/routes.js";
import trackRoutes from "../entities/track/routes.js";
import type { EntityKind } from "../entities/types.js";
import { authenticated } from "../middleware/authenticated.js";
import { authorizeProject } from "../middleware/authorize-project.js";
import { resolveEntityRoute } from "../middleware/project-resolvers.js";
import {
  entityListRoutes,
  genericBulkRoutes,
  genericRoutes,
} from "./generic.js";

/**
 * The one place a router file is named. The registry itself holds no routers —
 * the query layer reads it, and routes read the query layer — so the pairing
 * of a module with the routes only it has lives here instead.
 */
const ENTITY_ROUTERS: Record<EntityKind, Hono<AuthedEnv>> = {
  project: projectRoutes,
  collection: collectionRoutes,
  track: trackRoutes,
  session: sessionRoutes,
};

/** The root app's environment, before `authenticated` has narrowed the user. */
type RootEnv = { Variables: AuthType & RequestIdVariables };

/**
 * Mounts every entity: the session gate and the project gate its module
 * describes, then the routes only it has, then the ones every entity shares.
 * `genericBulkRoutes` goes first: its paths are all literal (`/bulk`,
 * `/bulk/move`), so mounting it ahead of the entity's own router keeps those
 * literals from being read as an id by a dynamic route the entity router
 * defines (`/:id/move`). Everything else in the entity's own router is
 * dynamic or lives under its own literal prefix, so
 * it still needs to go first, before the rest of `genericRoutes` — a static
 * path there must be matched before the generic `/:id` shape it would
 * otherwise fall into.
 */
export function mountEntities(app: Hono<RootEnv>): void {
  for (const module of entityModules()) {
    const path = module.mountPath;
    app.use(`${path}/*`, authenticated);
    app.use(
      `${path}/*`,
      authorizeProject(resolveEntityRoute(module), module.policy)
    );
    app.route(path, genericBulkRoutes(module));
    app.route(path, ENTITY_ROUTERS[module.kind]);
    app.route(path, genericRoutes(module));
  }

  // Every project-scoped listing hangs off the project's own mount, which the
  // loop above has already gated.
  app.route("/projects", entityListRoutes());
}
