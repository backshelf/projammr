import "dotenv/config";
import { Scalar } from "@scalar/hono-api-reference";
import { type Context, Hono } from "hono";
import { openAPIRouteHandler } from "hono-openapi";
import { except } from "hono/combine";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import type { RequestIdVariables } from "hono/request-id";
import type { AuthType } from "./auth.js";
import { auth as authHandler, mcpServed } from "./auth.js";
import { getInvitePreview, invitePreviewSchema } from "./db/queries/invites.js";
import { trustedOrigins } from "./lib/env.js";
import { checkHealth, healthSchema } from "./lib/health.js";
import { json, jsonErrorHandler, respond } from "./lib/http.js";
import mcp from "./mcp/route.js";
import { authenticated, guestAccess } from "./middleware/authenticated.js";
import { authorizeProject } from "./middleware/authorize-project.js";
import {
  packBodyLimit,
  requestBodyCap,
  uploadBodyLimit,
} from "./middleware/body-limit.js";
import {
  resolveAssetRoute,
  resolveCommentRoute,
  resolveImageRoute,
  resolveInviteRoute,
  resolveCommitRoute,
  resolveSaveRoute,
  resolveJobRoute,
  resolveRepoRoute,
  resolveSampleRoute,
  resolveSettingsRoute,
  resolveStatusRoute,
  resolveTrackAudioRoute,
} from "./middleware/project-resolvers.js";
import { instanceAdmin } from "./middleware/instance-admin.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { requestLog } from "./middleware/request-log.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { resolveSession } from "./middleware/session.js";
import { csrfProtection } from "./middleware/trusted-origin.js";
import admin from "./routes/admin.js";
import assets from "./routes/assets.js";
import auth from "./routes/auth.js";
import comments from "./routes/comments.js";
import { mountEntities } from "./routes/entities.js";
import images from "./routes/images.js";
import instance, { instanceDocs } from "./routes/instance.js";
import invites, { inviteDocs } from "./routes/invites.js";
import jobs from "./routes/jobs.js";
import lyrics from "./routes/lyrics.js";
import machines, { sessionPresenceRoutes } from "./routes/machines.js";
import { sessionRenderRoutes } from "./routes/session-renders.js";
import me from "./routes/me.js";
import notes from "./routes/notes.js";
import { commitRoutes } from "./routes/commits.js";
import { repoArchiveRoutes } from "./routes/repo-archive.js";
import { sampleRoutes } from "./routes/samples.js";
import { saveRoutes } from "./routes/saves.js";
import {
  repoHistoryRoutes,
  sessionHistoryRoutes,
} from "./routes/repo-history.js";
import { repoObjectRoutes } from "./routes/repo-objects.js";
import {
  entityRepoRoutes,
  projectRepoRoutes,
  repoRoutes,
} from "./routes/repos.js";
import settings from "./routes/settings.js";
import shareGuest from "./routes/share-guest.js";
import sharelinks from "./routes/sharelinks.js";
import statuses from "./routes/statuses.js";
import trackAudios from "./routes/track-audios.js";
import uploads from "./routes/uploads.js";
import { staticFiles } from "./static.js";

export let app = new Hono<{ Variables: AuthType & RequestIdVariables }>({
  strict: false,
});

app.use("*", requestId());
app.use("*", requestLog);
app.use("*", securityHeaders);

// Ahead of everything else on `/api/*`, session resolution included: a
// refused origin should cost nothing more than the check itself, and a
// cookie must never reach a handler on a request this rejects.
app.use("/api/*", csrfProtection);

// Before anything reads a body: every request but an upload's POST is held to
// the fixed cap. The uploads are held to the instance's upload limit instead,
// at their own POST mounts below — after `authenticated`, before
// `authorizeProject` reads the form. Any other method on an upload path keeps
// the cap, since nothing else would bound what a resolver buffers.
const UPLOAD_PATHS = new Set([
  "/api/assets/upload",
  "/api/images/upload",
  "/api/images/instance",
]);
/** A repo's pack upload; the negotiation beside it keeps the fixed cap. */
const REPO_PACK_PATH = /^\/api\/repos\/\d+\/objects$/;
const isUploadPost = (c: Context) =>
  c.req.method === "POST" &&
  (UPLOAD_PATHS.has(c.req.path) || REPO_PACK_PATH.test(c.req.path));
app.use("*", except(isUploadPost, requestBodyCap));

// Registered ahead of the session middleware, and so with its full path: a
// monitor carries no cookies, and resolving a session it does not have is work
// the check should not wait on.
app.get(
  "/api/health",
  instanceDocs.route({
    description: "Whether the deployment can serve requests.",
    responses: {
      200: json(healthSchema, "Health report"),
      503: json(healthSchema, "Database unreachable"),
    },
  }),
  async (c) => {
    const health = await checkHealth();
    return respond(c, healthSchema, health, health.db ? 200 : 503);
  }
);

// Registered on the root app rather than the `/api` sub-app so that
// `/static/*` is covered by the same session resolution.
app.use("*", resolveSession);

app.route("/", staticFiles);

// OAuth discovery (RFC 9728 protected-resource and RFC 8414 authorization-
// server metadata) lives at the origin root. Better Auth answers it from a
// request hook, which only runs for requests that reach its handler.
app.all("/.well-known/*", (c) => authHandler.handler(c.req.raw));

app = app.basePath("/api");

app.use(
  cors({
    origin: trustedOrigins,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  })
);

// A spec names every route and body its API takes. In development it is what
// the client generates its types from; in production it is a map for anyone who
// has not signed in, so a session is required for it there.
const specNeedsSession = createMiddleware<{ Variables: AuthType }>(
  async (c, next) => {
    if (process.env.NODE_ENV === "production" && !c.get("user")) {
      throw new HTTPException(401);
    }
    await next();
  }
);

app.use("/openapi", specNeedsSession);

app.get(
  "/openapi",
  openAPIRouteHandler(app, {
    documentation: {
      info: {
        // The spec's title: the committed `apps/web/openapi/api.json` retitles it.
        title: "PROJAMMR_API",
        version: "1.0.0",
        description:
          "The REST API behind Projammr: projects, collections, tracks, sessions, their audio, comments and notes. The web client and the share page both use it.",
      },
      servers: [
        {
          url: process.env.BASE_URL || "http://localhost:8080",
        },
      ],
    },
  })
);

// A browsable reference for the spec above. Anonymous production traffic gets a
// 404 rather than a 401: there is nothing to sign in to here, and the endpoint
// is not worth advertising.
app.use("/docs", async (c, next) => {
  if (process.env.NODE_ENV === "production" && !c.get("user")) {
    throw new HTTPException(404);
  }
  await next();
});

app.get("/docs", Scalar({ url: "/api/openapi", pageTitle: "PROJAMMR API" }));

// Better Auth's own spec, a map of the sign-in surface, behind the same gate.
// Its `openAPI()` plugin serves that same document from two more paths under
// the `/auth/*` catch-all — the schema itself, and a Scalar page rendering it —
// so all three are gated together. Gating only the alias below would leave the
// document a `curl` away.
app.use("/auth/openapi", specNeedsSession);
app.use("/auth/open-api/*", specNeedsSession);
app.use("/auth/reference", specNeedsSession);

app.get("/auth/openapi", async (c) => {
  return c.json(await authHandler.api.generateOpenAPISchema());
});

// The invite-acceptance page reads this before the invitee has signed in, so
// it is registered ahead of the authenticated `/invites/*` mount. The token is
// the secret; the payload is limited to what the page needs to greet them.
// An instance that turns guest access off shows it to real accounts only.
app.get(
  "/invites/:token",
  inviteDocs.describe(
    "Public preview of an invite, keyed by its token. Read by the acceptance page before sign-in.",
    { schema: invitePreviewSchema, description: "Invite preview" },
    401,
    404
  ),
  guestAccess,
  async (c) => {
    return respond(
      c,
      invitePreviewSchema,
      await getInvitePreview(c.req.param("token"))
    );
  }
);

// Public, like the invite preview above it: the sign-in page reads this before
// anyone has signed in, and an instance with no account yet has nobody who
// could.
app.route("/instance", instance);

mountEntities(app);

// A project's repos hang off the project's own mount, which `mountEntities`
// has already gated on the project in the path.
app.route("/projects", projectRepoRoutes());
app.route("/tracks", entityRepoRoutes("track"));
app.route("/collections", entityRepoRoutes("collection"));

// A session's dit history and the machines on it hang off the session's own
// mount, gated the same way.
app.route("/sessions", sessionHistoryRoutes());
app.route("/sessions", sessionPresenceRoutes());
app.route("/sessions", sessionRenderRoutes());

app.use("/track-audios/*", authenticated);
app.use("/track-audios/*", authorizeProject(resolveTrackAudioRoute));
app.route("/track-audios", trackAudios);

// Revoking an invite is admin-only; accepting one is how a non-member joins,
// so its resolver returns an unscoped `Scope` and only authentication is
// enforced.
app.use("/invites/*", authenticated);
app.use(
  "/invites/*",
  authorizeProject(resolveInviteRoute, { default: "admin" })
);
app.route("/invites", invites);

app.use("/statuses/*", authenticated);
app.use("/statuses/*", authorizeProject(resolveStatusRoute));
app.route("/statuses", statuses);

app.use("/me/*", authenticated);
// `PATCH /me/email` checks the account's current password, which makes it a
// password oracle for anyone holding a session they should not — a borrowed
// cookie, a shared machine. The per-account sign-in lockout
// (`db/queries/signin-attempts.ts`) only guards `/auth/sign-in/email`, so
// without this the same guessing it stops at the front door runs unthrottled
// here. Keyed per user, since the caller is always signed in by this point.
app.use("/me/email", rateLimit("email-change"));
app.route("/me", me);

// Instance-wide rather than project-scoped: `instanceAdmin` is the gate, and it
// answers 404 to everyone else.
app.use("/admin/*", authenticated);
app.use("/admin/*", instanceAdmin);
app.route("/admin", admin);

// Not project-gated: `loadNoteAccess` is the gate, the same way `/me` needs
// no project at all — a note belongs to its author whether or not it is
// currently linked into anyone's project.
app.use("/notes/*", authenticated);
app.on("PATCH", "/notes/:id", rateLimit("notes-save"));
app.route("/notes", notes);

// One mount for every scope: `resolveSettingsRoute` turns the scope a request
// names into the gate — the caller's own id, a project membership, an
// instance admin. Locks and the change log are for a project's owner or
// admins; every other route is open to any member, since a write's per-key
// `minRole` depends on the body, which this policy never sees — the write
// checks it. The bucket sizes the hub's debounced saves, not abuse.
app.use("/settings/*", authenticated);
app.use(
  "/settings/*",
  authorizeProject(resolveSettingsRoute, (c) =>
    c.req.method === "PUT" || c.req.path.endsWith("/settings/audit")
      ? "admin"
      : "viewer"
  )
);
app.on(["PATCH", "PUT", "POST"], "/settings/*", rateLimit("settings-write"));
app.route("/settings", settings);

// Not project-gated: these only ever answer questions about words the client
// sends, never about stored track content. The bucket sizes the gutter's
// traffic (300ms-debounced, cached per word), not abuse.
app.use("/lyrics/*", authenticated);
app.on("POST", "/lyrics/analyze", rateLimit("lyrics-analyze"));
app.route("/lyrics", lyrics);

app.use("/comments/*", authenticated);
// Every member may join the discussion. Editing and deleting need no higher
// role here: the comment queries only ever touch the caller's own row.
app.use(
  "/comments/*",
  authorizeProject(resolveCommentRoute, {
    POST: "viewer",
    PATCH: "viewer",
    DELETE: "viewer",
  })
);
app.route("/comments", comments);

app.use("/images/*", authenticated);
app.on("POST", ["/images/upload", "/images/instance"], uploadBodyLimit);
app.use("/images/*", authorizeProject(resolveImageRoute));
// Uploads arrive in bursts — a user drags in an
// album — and each one is a bounded disk write, so the ceiling is set to stop a
// runaway client rather than to pace a legitimate sync.
app.on(
  "POST",
  ["/images/upload", "/images/instance"],
  rateLimit("image-upload")
);
app.route("/images", images);

// Not project-gated: the cap is the same for every project, and a caller
// reads it before it has anything to upload.
app.use("/uploads/*", authenticated);
app.route("/uploads", uploads);

app.use("/assets/*", authenticated);
app.on("POST", "/assets/upload", uploadBodyLimit);
app.use(
  "/assets/*",
  authorizeProject(resolveAssetRoute, (c) =>
    // A lookup only reads; it is a POST because its body is hundreds of
    // fingerprints long. Every other path under the mount falls back to the
    // method map, so a write still needs an editor.
    c.req.method === "POST" && c.req.path.endsWith("/assets/lookup")
      ? "viewer"
      : undefined
  )
);
app.on("POST", "/assets/upload", rateLimit("upload"));
// Each conversion is an ffmpeg run.
app.on("POST", "/assets/:id/convert", rateLimit("convert"));
app.route("/assets", assets);

app.use("/jobs/*", authenticated);
app.use("/jobs/*", authorizeProject(resolveJobRoute));
app.route("/jobs", jobs);

app.use("/commits/*", authenticated);
app.use("/commits/*", authorizeProject(resolveCommitRoute));
// A zip reads every object of a set and its samples, so it is metered per
// caller beside the other heavy reads.
app.on("GET", "/commits/:id/archive", rateLimit("repo-archive"));
app.route("/commits", commitRoutes());

app.use("/samples/*", authenticated);
app.use("/samples/*", authorizeProject(resolveSampleRoute));
app.route("/samples", sampleRoutes());
app.use("/saves/*", authenticated);
app.use("/saves/*", authorizeProject(resolveSaveRoute));
app.route("/saves", saveRoutes());

app.use("/repos/*", authenticated);
app.use(
  "/repos/*",
  authorizeProject(resolveRepoRoute, (c) =>
    // A fetch only reads the objects a repo holds, so a viewer may send them.
    // Every other path falls back to the method map, so a write still needs an
    // editor.
    c.req.method === "POST" && c.req.path.endsWith("/objects/fetch")
      ? "viewer"
      : undefined
  )
);
// The pack's length is checked after the gate, so a caller outside the project
// is a 404 before any byte is read. A push of a big set is several packs, so
// the upload is metered like the other uploads: against a runaway client, not
// a legitimate push.
app.on("POST", "/repos/:id/objects", packBodyLimit);
app.on("POST", "/repos/:id/objects", rateLimit("repo-objects"));
app.on("GET", "/repos/:id/archive", rateLimit("repo-archive"));
// A fetch reads up to 10,000 stored objects into one body, metered beside the
// archive.
app.on("POST", "/repos/:id/objects/fetch", rateLimit("repo-archive"));
app.route("/repos", repoRoutes());
app.route("/repos", repoArchiveRoutes());
app.route("/repos", repoHistoryRoutes());
app.route("/repos", repoObjectRoutes());

// Not project-gated: a machine belongs to its user, and every
// route checks the path's machine against the caller.
app.use("/machines/*", authenticated);
app.route("/machines", machines);

// Not project-gated at the mount level: a share link is read by guests who
// hold no project membership at all. The routes that create, edit or delete
// a link enforce an editor role themselves, on the project the shared entity
// belongs to; the guest-facing reads and the comment routes gate on the
// token instead. `sharelinks` (management, `authenticated`) is mounted
// **before** `shareGuest` (its reads gated only on the token, or
// `guestOrMember` for posting a comment): both routers answer under `/share`,
// and `sharelinks`' static paths (`/`, `/options`) must be tried before
// `shareGuest`'s `/:token` can swallow them as a token value.
app.route("/share", sharelinks);
app.route("/share", shareGuest);

// No `describeRoute`, so it stays out of `/api/openapi` and the generated
// client — a bearer-token MCP endpoint has no place in a cookie-authenticated
// API's own document. Registered only when `mcpServed`, read once at boot:
// an off server answers 404 here, like any other unknown path.
if (mcpServed) {
  app.route("/mcp", mcp);
}

// Dynamic client registration is open to anyone, so it is metered on its own;
// an unregistered client carries no user, so callers mostly share one bucket.
app.use("/auth/oauth2/register", rateLimit("oauth-register"));
// Every caller here is by definition not yet signed in, so each of these is
// keyed by `clientAddress` rather than a user id — the reason A4 gives that
// function a real meaning instead of trusting a header the caller chose.
app.use("/auth/sign-in/email", rateLimit("auth-signin"));
app.use("/auth/sign-up/email", rateLimit("auth-signup"));
app.use("/auth/sign-in/anonymous", rateLimit("guest-signin"));
// `/device/token` is deliberately unmetered: `dit login` polls it every few
// seconds for the code's lifetime, and the plugin answers a faster poll with
// `slow_down` itself.
app.use("/auth/device/code", rateLimit("device-signin"));
app.use("/auth/device", rateLimit("device-signin"));
app.route("/auth", auth);

app.onError(jsonErrorHandler);
