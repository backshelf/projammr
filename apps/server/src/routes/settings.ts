import { SETTINGS } from "@workspace/settings";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AuthedEnv } from "../auth.js";
import { isInstanceAdmin } from "../db/queries/authorization.js";
import {
  AUDIT_PAGE_LIMIT,
  anyLocksSchema,
  changedHubRowsSchema,
  effectiveFor,
  effectiveSettingsSchema,
  exportUserSettings,
  hubRowsFor,
  hubRowsSchema,
  importReportSchema,
  importUserSettings,
  instanceTarget,
  listAudit,
  patchSchema,
  projectTarget,
  setLocks,
  settingsAuditPageSchema,
  settingsExportSchema,
  userTarget,
  writeSettings,
  type SettingTarget,
  type SettingsContext,
} from "../db/queries/settings.js";
import { rawSettingsAuditScopeEnum } from "../db/schema/enums.js";
import { describer, idValue, params, respond, validator } from "../lib/http.js";
import { gatedProject } from "../middleware/authorize-project.js";

const { describe } = describer("Settings");

const app = new Hono<AuthedEnv>();

/** The scopes a route can address. */
const targetScopeSchema = z.enum(["user", "project", "instance"]);

type TargetScope = z.infer<typeof targetScopeSchema>;

/**
 * The target a request names, once the gate has checked it: the caller's own
 * id for `user`, a project they belong to for `project`, and an instance admin
 * for `instance`.
 */
const TARGETS: Record<TargetScope, (c: Context<AuthedEnv>) => SettingTarget> = {
  user: (c) => userTarget(c.get("user").id),
  project: (c) => projectTarget(gatedProject(c)),
  instance: () => instanceTarget,
};

/** The caller, the project the gate resolved (if any) and their role in it. */
const contextOf = async (c: Context<AuthedEnv>): Promise<SettingsContext> => {
  const userId = c.get("user").id;
  return {
    userId,
    projectId: c.get("projectId"),
    role: c.get("role"),
    isAdmin: await isInstanceAdmin(userId),
  };
};

/** The project a read layers between the caller's own settings and the instance's. */
const contextQuerySchema = z.object({ project: idValue.optional() });

const targetParams = params({ scope: targetScopeSchema, id: z.string() });

app.get(
  "/effective",
  describe(
    "The caller's effective settings. Every setting they receive, resolved over their own settings, the named project's, the instance's, the environment and the defaults; `version` changes whenever a value does.",
    { schema: effectiveSettingsSchema, description: "Effective settings" },
    400,
    404
  ),
  validator("query", contextQuerySchema),
  async (c) =>
    respond(c, effectiveSettingsSchema, await effectiveFor(await contextOf(c)))
);

app.get(
  "/",
  describe(
    "The caller's settings as the hub shows them. For every setting they receive: the effective value and its source, the lock pinning it, where the caller may write it, and what each scope holds. Names a project as the effective read does.",
    { schema: hubRowsSchema, description: "Settings" },
    400,
    404
  ),
  validator("query", contextQuerySchema),
  async (c) => respond(c, hubRowsSchema, await hubRowsFor(await contextOf(c)))
);

app.get(
  "/audit",
  describe(
    "Recent changes to a project's or the instance's settings. Newest first; page with `before`, the id of the last row of the previous page.",
    { schema: settingsAuditPageSchema, description: "Settings changes" },
    400,
    403,
    404
  ),
  validator(
    "query",
    z.object({
      scope: z.enum(rawSettingsAuditScopeEnum),
      id: z.string().optional(),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(AUDIT_PAGE_LIMIT)
        .default(AUDIT_PAGE_LIMIT),
      before: z.coerce.number().int().positive().optional(),
    })
  ),
  async (c) => {
    const { scope, limit, before } = c.req.valid("query");
    return respond(
      c,
      settingsAuditPageSchema,
      await listAudit(TARGETS[scope](c), { limit, before })
    );
  }
);

app.get(
  "/user/:id/export",
  describe(
    "The caller's own settings as a file an import takes back.",
    { schema: settingsExportSchema, description: "Settings export" },
    404
  ),
  params({ id: z.string() }),
  async (c) =>
    respond(c, settingsExportSchema, await exportUserSettings(c.get("user").id))
);

app.post(
  "/user/:id/import",
  describe(
    "Applies an export to the caller's own settings. A key the registry does not know, that takes no personal value, whose value is invalid, or that the instance locks is skipped and reported rather than refusing the file. `dryRun` reports without writing.",
    { schema: importReportSchema, description: "Import report" },
    400,
    404
  ),
  params({ id: z.string() }),
  validator("query", z.object({ dryRun: z.stringbool().optional() })),
  validator("json", settingsExportSchema),
  async (c) =>
    respond(
      c,
      importReportSchema,
      await importUserSettings(c.get("user").id, c.req.valid("json"), {
        dryRun: c.req.valid("query").dryRun ?? false,
      })
    )
);

app.patch(
  "/:scope/:id",
  describe(
    "Writes settings at one scope: `{[key]: value}`, `null` clearing the key there so it inherits again. A key the scope does not accept is a 400; one the caller's role may not write, a 403, as is clearing a row locked at this scope by a caller who may not lock there (clearing lifts the lock); a value for one the instance locks, a 409 `setting_locked` with the scope and the lock in `details`, and nothing is written (clearing it is allowed: the row is inert under the lock). Answers with the hub's view of the keys written.",
    { schema: changedHubRowsSchema, description: "Settings written" },
    400,
    403,
    404,
    409
  ),
  targetParams,
  validator("json", patchSchema(Object.values(SETTINGS))),
  async (c) => {
    const context = await contextOf(c);
    const keys = await writeSettings(
      TARGETS[c.req.valid("param").scope](c),
      c.req.valid("json"),
      context
    );
    return respond(c, changedHubRowsSchema, await hubRowsFor(context, keys));
  }
);

app.put(
  "/:scope/:id/locks",
  describe(
    "Sets or lifts locks at a project or the instance: `{[key]: boolean}`. Locking a key the scope holds no value for first stores the value it resolves to there. A key declared unlockable, or one the scope does not accept, is a 400; a scope that cannot lock (a user's) is a 404. Answers with the hub's view of the keys named.",
    { schema: changedHubRowsSchema, description: "Locks set" },
    400,
    403,
    404,
    409
  ),
  targetParams,
  validator("json", anyLocksSchema),
  async (c) => {
    const context = await contextOf(c);
    const keys = await setLocks(
      TARGETS[c.req.valid("param").scope](c),
      c.req.valid("json"),
      context
    );
    return respond(c, changedHubRowsSchema, await hubRowsFor(context, keys));
  }
);

export default app;
