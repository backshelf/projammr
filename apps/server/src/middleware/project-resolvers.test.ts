import { Hono } from "hono";
import pg from "pg";
import { eq } from "drizzle-orm";
import { describe, expect, it, spyOn } from "bun:test";
import type { AuthType } from "../auth.js";

import { db } from "../db/index.js";
import { users } from "../db/schema/auth.js";
import { ENTITIES } from "../entities/index.js";
import {
  baseUrl,
  setupSuite,
  signUpAndSignIn,
  type Actor,
} from "../test/fixtures.js";
import { authenticated } from "./authenticated.js";
import {
  authorizeProject,
  type ProjectIdResolver,
} from "./authorize-project.js";
import { resolveEntityRoute } from "./project-resolvers.js";
import { resolveSession } from "./session.js";

const suite = setupSuite("Resolvers");
const {
  editor,
  outsider,
  requireProject,
  request,
  requestAs,
  seedMember,
  uploadAvatar,
} = suite;

// A resolver has no `"skip"` answer: a `Scope` is a project or an instance, so
// one that returns the sentinel is a compile error, not a route that quietly
// authorizes on nothing. This assignment only exists to be rejected.
// @ts-expect-error — "skip" is not a `Scope`; a resolver may no longer return it.
const _legacySkipResolver: ProjectIdResolver = () => "skip";
void _legacySkipResolver;

describe("project context", () => {
  it("hands the gated project and the caller's role to the route it guards", async () => {
    requireProject();

    // Mounted the way the real app mounts it — the resolvers read the project
    // id out of the path by position, so the `/api` prefix has to be there.
    const root = new Hono<{ Variables: AuthType }>({ strict: false });
    root.use("*", resolveSession);
    const probe = root.basePath(baseUrl);
    probe.use("/projects/*", authenticated);
    probe.use(
      "/projects/*",
      authorizeProject(resolveEntityRoute(ENTITIES.project))
    );
    probe.get("/projects/:id", (c) =>
      c.json({ projectId: c.get("projectId"), role: c.get("role") })
    );

    const asEditor = await root.request(
      `${baseUrl}/projects/${suite.projectId}`,
      {
        headers: { Cookie: editor.cookie },
      }
    );
    expect(asEditor.status).toBe(200);
    expect(await asEditor.json()).toEqual({
      projectId: suite.projectId,
      role: "editor",
    });

    const asOutsider = await root.request(
      `${baseUrl}/projects/${suite.projectId}`,
      {
        headers: { Cookie: outsider.cookie },
      }
    );
    expect(asOutsider.status).toBe(404);
  });

  it("looks the caller's membership up once for a request that reports their role", async () => {
    requireProject();

    const querySpy = spyOn(pg.Pool.prototype, "query");
    querySpy.mockClear();

    const res = await request("viewer", `/projects/${suite.projectId}`);
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe("viewer");

    const membershipLookups = querySpy.mock.calls.filter(([statement]) => {
      const sql =
        typeof statement === "string"
          ? statement
          : ((statement as { text?: string }).text ?? "");
      return sql.includes('"members"');
    });
    expect(membershipLookups.length).toBe(1);

    querySpy.mockRestore();
  });
});

/**
 * `resolveStatusRoute` answers `{ kind: "instance" }` for a read of a seeded
 * (global, null-project) status and refuses every write to one itself, before
 * any membership or admin check, which is why a non-member, a project admin
 * and an instance admin all fare the same here. The reads every signed-in
 * caller is allowed are in `routes/statuses.test.ts`.
 */
describe("resolveStatusRoute (instance scope)", () => {
  it("refuses every write to a seeded global status, whatever the caller's project role", async () => {
    requireProject();

    const admin: Actor = await signUpAndSignIn("Status Resolver Admin");
    await seedMember(admin, "admin");

    const writes: [string, () => Promise<Response>, number][] = [
      [
        "member (viewer)",
        () =>
          request("viewer", "/statuses/1", {
            method: "PATCH",
            body: JSON.stringify({ name: "Renamed" }),
          }),
        403,
      ],
      [
        "member (editor)",
        () => request("editor", "/statuses/1", { method: "DELETE" }),
        403,
      ],
      [
        "non-member",
        () =>
          request("outsider", "/statuses/1", {
            method: "PATCH",
            body: JSON.stringify({ name: "Renamed" }),
          }),
        403,
      ],
      [
        "project admin",
        async () => requestAs(admin, "/statuses/1", { method: "DELETE" }),
        403,
      ],
      [
        "guest (unauthenticated)",
        () =>
          request("anonymous", "/statuses/1", {
            method: "PATCH",
            body: JSON.stringify({ name: "Renamed" }),
          }),
        401,
      ],
    ];

    for (const [label, run, expectedStatus] of writes) {
      const res = await run();
      expect(res.status, label).toBe(expectedStatus);
    }
  });

  it("refuses a write to a seeded global status with the status's own message, instance admin or not", async () => {
    requireProject();

    const instanceAdmin: Actor = await signUpAndSignIn("Status Instance Admin");
    await db
      .update(users)
      .set({ instanceRole: "admin" })
      .where(eq(users.id, instanceAdmin.userId));

    type Send = () => Promise<Response> | Response;
    const callers: [string, Send, Send][] = [
      [
        "non-admin",
        () =>
          request("editor", "/statuses/1", {
            method: "PATCH",
            body: JSON.stringify({ name: "Renamed" }),
          }),
        () => request("editor", "/statuses/1", { method: "DELETE" }),
      ],
      [
        "instance admin",
        () =>
          requestAs(instanceAdmin, "/statuses/1", {
            method: "PATCH",
            body: JSON.stringify({ name: "Renamed" }),
          }),
        () => requestAs(instanceAdmin, "/statuses/1", { method: "DELETE" }),
      ],
    ];

    for (const [label, patch, remove] of callers) {
      const patched = await patch();
      expect(patched.status, `PATCH as ${label}`).toBe(403);
      expect((await patched.json()).error, `PATCH as ${label}`).toBe(
        "Cannot change global statuses"
      );

      const deleted = await remove();
      expect(deleted.status, `DELETE as ${label}`).toBe(403);
      expect((await deleted.json()).error, `DELETE as ${label}`).toBe(
        "Cannot delete global statuses"
      );
    }
  });
});

/**
 * `resolveImageRoute` answers `{ kind: "user", id }` for an avatar
 * (`images.scope === "user"`). Ownership, not project role, decides access —
 * a caller's membership on the suite's project has no bearing on someone
 * else's avatar.
 */
describe("resolveImageRoute (user scope)", () => {
  it("gates an avatar on its own uploader alone, whatever the caller's project role", async () => {
    requireProject();

    const admin: Actor = await signUpAndSignIn("Image Resolver Admin");
    await seedMember(admin, "admin");
    const avatar = await uploadAvatar("resolver-read.jpeg");

    const reads: [string, () => Promise<Response>, number][] = [
      ["member (viewer)", () => request("viewer", `/images/${avatar.id}`), 404],
      ["member (editor)", () => request("editor", `/images/${avatar.id}`), 404],
      ["non-member", () => request("outsider", `/images/${avatar.id}`), 404],
      [
        "project admin",
        async () => requestAs(admin, `/images/${avatar.id}`),
        404,
      ],
      [
        "guest (unauthenticated)",
        () => request("anonymous", `/images/${avatar.id}`),
        401,
      ],
      ["owner", () => request("owner", `/images/${avatar.id}`), 200],
    ];

    for (const [label, run, expectedStatus] of reads) {
      const res = await run();
      expect(res.status, label).toBe(expectedStatus);
    }
  });

  it("lets only the uploader delete their avatar", async () => {
    requireProject();

    const toDelete = await uploadAvatar("resolver-delete.jpeg");

    const refused: [string, () => Promise<Response>, number][] = [
      [
        "member (editor)",
        () => request("editor", `/images/${toDelete.id}`, { method: "DELETE" }),
        404,
      ],
      [
        "non-member",
        () =>
          request("outsider", `/images/${toDelete.id}`, { method: "DELETE" }),
        404,
      ],
      [
        "guest (unauthenticated)",
        () =>
          request("anonymous", `/images/${toDelete.id}`, { method: "DELETE" }),
        401,
      ],
    ];

    for (const [label, run, expectedStatus] of refused) {
      const res = await run();
      expect(res.status, label).toBe(expectedStatus);
    }

    const ownerDeletes = await request("owner", `/images/${toDelete.id}`, {
      method: "DELETE",
    });
    expect(ownerDeletes.status).toBe(204);
  });
});
