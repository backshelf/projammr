import { existsSync } from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "bun:test";
import { waitFor } from "@workspace/test/wait-for";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { invalidateMembershipCache } from "../../db/queries/authorization.js";
import { getJob } from "../../db/queries/jobs.js";
import { withProjectPolicyForTest } from "../../db/queries/project-policy.js";
import { MAX_SEARCH_LIMIT } from "../../db/queries/search.js";
import { recordRevisions } from "../../db/queries/saves.js";
import { activity } from "../../db/schema/activity.js";
import { assets } from "../../db/schema/assets.js";
import { collections, collectionTracks } from "../../db/schema/collections.js";
import { images } from "../../db/schema/images.js";
import { jobs } from "../../db/schema/jobs.js";
import { invites, members, projects } from "../../db/schema/projects.js";
import type { SessionSample } from "../../db/schema/samples.js";
import { savedViews } from "../../db/schema/saved-views.js";
import { saves } from "../../db/schema/saves.js";
import { sessions } from "../../db/schema/sessions.js";
import { trackAudios, tracks } from "../../db/schema/tracks.js";
import { IDLE_TIMEOUT_SECONDS } from "../../lib/connections.js";
import { projectListenerCount, publishJob } from "../../lib/job-events.js";
import type { Actor } from "../../test/fixtures.js";
import {
  baseUrl,
  cookieHeaders,
  fakeWav,
  onDiskPath,
  setupSuite,
  signUpAndSignIn,
  testImage,
  trustedOrigin,
} from "../../test/fixtures.js";
import { makeAudible, settleJobs } from "../../test/media.js";
import { sseReader } from "../../test/sse.js";
import {
  QUIET_LIMIT,
  TODAY_RENDER_LIMIT,
  TODAY_SAVE_LIMIT,
} from "./queries.js";

/** A minimal BlockNote document holding a single paragraph of text. */
function paragraphDoc(text: string): Record<string, unknown>[] {
  return [{ type: "paragraph", content: [{ type: "text", text }] }];
}

const suite = setupSuite("Project");
const {
  owner,
  editor,
  viewer,
  requireProject,
  request,
  requestAs,
  expectAccess,
  seedMember,
  throwawayProject,
  mkTrack,
  mkCollection,
  mkSession,
  mkStatus,
  uploadAsset,
} = suite;

/** A project's priority levels by name, as its scale route lists them. */
async function levelIds(
  projectId = suite.projectId,
  as: Actor = owner
): Promise<Record<string, number>> {
  const res = await requestAs(as, `/projects/${projectId}/priorities`);
  const levels = (await res.json()) as { id: number; name: string }[];
  return Object.fromEntries(levels.map((level) => [level.name, level.id]));
}

describe("shared project setup", () => {
  it("creates the project and makes its creator an owner", async () => {
    requireProject();
    expect(suite.projectId).toBeTypeOf("number");

    const roster = await (
      await request("owner", `/projects/${suite.projectId}/members`)
    ).json();
    expect(
      roster.find((m: { userId: string }) => m.userId === owner.userId)?.role
    ).toBe("owner");
  });

  it("rejects unauthenticated and non-member callers on every mount", async () => {
    requireProject();

    // One representative path per mounted router, so a router mounted without
    // the authenticated/authorizeProject pair is caught here.
    const mounts: [string, string][] = [
      ["GET", `/projects/${suite.projectId}`],
      ["GET", `/projects/${suite.projectId}/tracks/summary`],
      ["GET", `/assets/project/${suite.projectId}`],
      ["GET", `/images/project/${suite.projectId}`],
      ["GET", `/projects/${suite.projectId}/invites`],
    ];

    for (const [method, path] of mounts) {
      const anon = await request("anonymous", path, { method });
      expect(anon.status, `${method} ${path} anonymous`).toBe(401);
      const stranger = await request("outsider", path, { method });
      expect(stranger.status, `${method} ${path} outsider`).toBe(404);
    }
  });

  it("answers an outsider the same 404 a nonexistent project id gets, never 403", async () => {
    requireProject();

    const forReal = await request("outsider", `/projects/${suite.projectId}`);
    const forMissing = await request("outsider", "/projects/999999999");

    expect(forReal.status).toBe(404);
    expect(forMissing.status).toBe(404);
    const { error: realError } = (await forReal.json()) as { error: string };
    const { error: missingError } = (await forMissing.json()) as {
      error: string;
    };
    expect(realError).toBe(missingError);
  });

  it("accepts a Bearer token and rejects a request with no credentials", async () => {
    requireProject();

    // The scanner's auth path: a raw sign-in token, no session cookie.
    const bearer = await app.request(`${baseUrl}/me/projects`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(bearer.status).toBe(200);

    const anon = await app.request(`${baseUrl}/me/projects`);
    expect(anon.status).toBe(401);
  });
});

describe("projects", () => {
  it("reads the project and its child collections for a member", async () => {
    requireProject();

    const project = await request("viewer", `/projects/${suite.projectId}`);
    expect(project.status).toBe(200);
    const projectBody = await project.json();
    expect(projectBody.id).toBe(suite.projectId);
    expect(projectBody.role).toBe("viewer");

    const asOwner = await (
      await request("owner", `/projects/${suite.projectId}`)
    ).json();
    expect(asOwner.role).toBe("owner");

    for (const child of [
      "collections/summary",
      "statuses",
      "tracks/summary",
      "sessions",
    ]) {
      const res = await request(
        "viewer",
        `/projects/${suite.projectId}/${child}`
      );
      expect(res.status, `GET /projects/:id/${child}`).toBe(200);
      expect(Array.isArray(await res.json())).toBe(true);
    }
  });

  it("gates project reads, writes, and deletion by role", async () => {
    requireProject();

    await expectAccess(
      "GET",
      `/projects/${suite.projectId}`,
      { viewer: 200, editor: 200, owner: 200 },
      undefined,
      (body, caller) => {
        const project = body as { id: number; role: string };
        // The row each role gets back is this project, at their own rank — a
        // 200 carrying another tenant's project would pass on status alone.
        expect(project.id).toBe(suite.projectId);
        expect(project.role).toBe(caller);
      }
    );

    await expectAccess(
      "PATCH",
      `/projects/${suite.projectId}`,
      { viewer: 403, editor: 200 },
      { description: paragraphDoc("edited by an editor") },
      (body) => {
        const project = body as {
          id: number;
          description: Record<string, unknown>[];
        };
        expect(project.id).toBe(suite.projectId);
        expect(project.description).toEqual(
          paragraphDoc("edited by an editor")
        );
      }
    );

    // Deletion is owner-only, so an editor is refused. The owner's delete is
    // left to afterAll — asserting it here would destroy the shared project.
    const editorDelete = await request(
      "editor",
      `/projects/${suite.projectId}`,
      {
        method: "DELETE",
      }
    );
    expect(editorDelete.status).toBe(403);
    const viewerDelete = await request(
      "viewer",
      `/projects/${suite.projectId}`,
      {
        method: "DELETE",
      }
    );
    expect(viewerDelete.status).toBe(403);
  });

  it("patches only the fields the body names", async () => {
    requireProject();
    // Its own project: a patch here would otherwise change the row every other
    // test in this file reads.
    const other = await suite.throwawayProject("Patchable");
    const before = await (
      await requestAs(other.owner, `/projects/${other.id}`)
    ).json();

    const links = [{ name: "Drive", url: "https://drive.test/folder" }];
    const description = paragraphDoc("Notes for the record");
    const patched = await requestAs(other.owner, `/projects/${other.id}`, {
      method: "PATCH",
      body: JSON.stringify({ description, links }),
    });
    expect(patched.status).toBe(200);

    const after = await patched.json();
    expect(after.description).toEqual(description);
    expect(after.links).toEqual(links);
    expect(after.name).toBe(before.name);
    expect(after.image).toBe(before.image);
    expect(after.createdAt).toBe(before.createdAt);

    // The block document round-trips through a fresh read, not just the
    // PATCH response.
    const reread = await (
      await requestAs(other.owner, `/projects/${other.id}`)
    ).json();
    expect(reread.description).toEqual(description);
  });

  it("ignores a patch key the edit schema does not name", async () => {
    requireProject();
    const other = await suite.throwawayProject("Unpatchable");
    const before = await (
      await requestAs(other.owner, `/projects/${other.id}`)
    ).json();

    const patched = await requestAs(other.owner, `/projects/${other.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: "Renamed",
        id: before.id + 10_000,
        createdAt: "1999-01-01T00:00:00.000Z",
      }),
    });
    expect(patched.status).toBe(200);

    const after = await patched.json();
    expect(after.name).toBe("Renamed");
    expect(after.id).toBe(other.id);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it("refuses a link that is not a url", async () => {
    requireProject();
    const other = await suite.throwawayProject("Bad Links");

    const patched = await requestAs(other.owner, `/projects/${other.id}`, {
      method: "PATCH",
      body: JSON.stringify({ links: [{ name: "Drive", url: "not-a-url" }] }),
    });
    expect(patched.status).toBe(400);
  });

  it("attaches an asset to the project for an editor but not a viewer", async () => {
    requireProject();
    const asset = await uploadAsset("project-attachment.jpeg");

    await expectAccess(
      "POST",
      `/projects/${suite.projectId}/attachments`,
      { viewer: 403, editor: 201 },
      { assetId: asset.id }
    );

    const project = await (
      await request("owner", `/projects/${suite.projectId}`)
    ).json();
    expect(
      project.attachments.some((a: { id: number }) => a.id === asset.id)
    ).toBe(true);
  });

  it("409s attaching the same asset to a project twice", async () => {
    requireProject();
    const asset = await uploadAsset("project-attachment-twice.jpeg");
    const attach = () =>
      request("owner", `/projects/${suite.projectId}/attachments`, {
        method: "POST",
        body: JSON.stringify({ assetId: asset.id }),
      });

    expect((await attach()).status).toBe(201);
    expect((await attach()).status).toBe(409);
  });

  it("lists only the caller's own projects on /me/projects", async () => {
    requireProject();

    const mine = await (await request("owner", "/me/projects")).json();
    expect(mine.some((p: { id: number }) => p.id === suite.projectId)).toBe(
      true
    );

    const theirs = await (await request("outsider", "/me/projects")).json();
    expect(theirs.some((p: { id: number }) => p.id === suite.projectId)).toBe(
      false
    );
  });

  it("reports trackCount and lastActivityAt on /me/projects", async () => {
    const { id: freshProjectId, owner: freshOwner } =
      await throwawayProject("HomeList");

    // Creating the project itself logs a `created` activity row; clear it so
    // the "no activity" case is genuinely empty rather than freshly seeded.
    await db.delete(activity).where(eq(activity.projectId, freshProjectId));

    const beforeTrack = await (
      await requestAs(freshOwner, "/me/projects")
    ).json();
    expect(
      beforeTrack.find((p: { id: number }) => p.id === freshProjectId)
    ).toMatchObject({ trackCount: 0, lastActivityAt: null });

    const created = await app.request(`${baseUrl}/tracks`, {
      method: "POST",
      headers: cookieHeaders(freshOwner.cookie),
      body: JSON.stringify({
        title: "Home list track",
        artists: ["A"],
        projectId: freshProjectId,
      }),
    });
    expect(created.status).toBe(201);

    const afterTrack = await (
      await requestAs(freshOwner, "/me/projects")
    ).json();
    const row = afterTrack.find((p: { id: number }) => p.id === freshProjectId);
    expect(row.trackCount).toBe(1);
    expect(row.lastActivityAt).not.toBeNull();
    expect(new Date(row.lastActivityAt).getTime()).not.toBeNaN();
  });

  it("counts live and archived tracks apart on /me/projects", async () => {
    const { id: freshProjectId, owner: freshOwner } =
      await throwawayProject("HomeArchived");
    const mk = async (title: string) => {
      const res = await app.request(`${baseUrl}/tracks`, {
        method: "POST",
        headers: cookieHeaders(freshOwner.cookie),
        body: JSON.stringify({
          title,
          artists: ["A"],
          projectId: freshProjectId,
        }),
      });
      expect(res.status).toBe(201);
      return (await res.json()).id as number;
    };
    await mk("Live one");
    await mk("Live two");
    const archivedId = await mk("Shelved");
    await db
      .update(tracks)
      .set({ archivedAt: new Date() })
      .where(eq(tracks.id, archivedId));

    const rows = await (await requestAs(freshOwner, "/me/projects")).json();
    expect(
      rows.find((p: { id: number }) => p.id === freshProjectId)
    ).toMatchObject({ trackCount: 2, archivedTrackCount: 1 });
  });

  it("returns archived tracks and their sessions, flagged, from the summary reads", async () => {
    requireProject();
    const liveOld = await mkTrack("Arch live old");
    const shelved = await mkTrack("Arch shelved");
    const liveNew = await mkTrack("Arch live new");
    // The archived track is the most recently updated, so only the
    // live-first ordering can put it last.
    await db
      .update(tracks)
      .set({ updatedAt: new Date(Date.now() - 60_000) })
      .where(eq(tracks.id, liveOld));
    await db
      .update(tracks)
      .set({ archivedAt: new Date(), updatedAt: new Date(Date.now() + 60_000) })
      .where(eq(tracks.id, shelved));
    const shelvedSession = await mkSession({
      name: "Arch shelved session",
      trackId: shelved,
    });
    const liveSession = await mkSession({
      name: "Arch live session",
      trackId: liveNew,
    });
    const loose = await mkSession({ name: "Arch loose session" });

    const trackRows = (await (
      await request("owner", `/projects/${suite.projectId}/tracks/summary`)
    ).json()) as { id: number; archivedAt: string | null }[];
    const ours = trackRows.filter((t) =>
      [liveOld, shelved, liveNew].includes(t.id)
    );
    expect(ours.map((t) => t.id)).toEqual([liveNew, liveOld, shelved]);
    expect(ours.map((t) => t.archivedAt !== null)).toEqual([
      false,
      false,
      true,
    ]);
    const lastLive = trackRows.findLastIndex((t) => t.archivedAt === null);
    const firstArchived = trackRows.findIndex((t) => t.archivedAt !== null);
    expect(firstArchived).toBeGreaterThan(lastLive);

    const summaries = (await (
      await request("owner", `/projects/${suite.projectId}/sessions/summary`)
    ).json()) as { id: number; archived: boolean }[];
    const flag = (id: number) => summaries.find((s) => s.id === id)?.archived;
    expect(flag(shelvedSession.id)).toBe(true);
    expect(flag(liveSession.id)).toBe(false);
    expect(flag(loose.id)).toBe(false);

    const detail = async (id: number) =>
      (await (await request("owner", `/sessions/${id}`)).json()) as {
        archived: boolean;
      };
    expect((await detail(shelvedSession.id)).archived).toBe(true);
    expect((await detail(liveSession.id)).archived).toBe(false);
    expect((await detail(loose.id)).archived).toBe(false);

    const scanned = (await (
      await request("owner", `/projects/${suite.projectId}/sessions`)
    ).json()) as { id: number }[];
    expect(scanned.map((s) => s.id)).toContain(shelvedSession.id);
  });

  it("404s a project that does not exist", async () => {
    requireProject();
    const res = await request("owner", "/projects/99999999");
    expect(res.status).toBe(404);
  });

  it("gates member management by role and guards the last owner", async () => {
    requireProject();

    // Member list is a read: any member sees it, an outsider does not.
    await expectAccess("GET", `/projects/${suite.projectId}/members`, {
      viewer: 200,
      editor: 200,
      owner: 200,
    });

    const roster = await (
      await request("owner", `/projects/${suite.projectId}/members`)
    ).json();
    expect(
      roster.some((m: { userId: string }) => m.userId === owner.userId)
    ).toBe(true);
    // A member's name identifies them; their email address is contact detail
    // the admin-only invite list carries and this one does not, and their
    // settings are their own — a column added to `users` must be excluded from
    // the public projection rather than ride along here.
    const ownerRow = roster.find(
      (m: { userId: string }) => m.userId === owner.userId
    );
    expect(ownerRow).toMatchObject({ user: { name: expect.any(String) } });
    expect(ownerRow.user).not.toHaveProperty("email");
    expect(ownerRow.user).not.toHaveProperty("prefs");

    // Changing a role needs admin — an editor cannot.
    await expectAccess(
      "PATCH",
      `/projects/${suite.projectId}/members/${viewer.userId}`,
      { editor: 403 },
      { role: "editor" }
    );

    // Promote the editor to admin, then let them manage members.
    const promote = await request(
      "owner",
      `/projects/${suite.projectId}/members/${editor.userId}`,
      { method: "PATCH", body: JSON.stringify({ role: "admin" }) }
    );
    expect(promote.status).toBe(200);

    const asAdmin = await request(
      "editor",
      `/projects/${suite.projectId}/members/${viewer.userId}`,
      { method: "PATCH", body: JSON.stringify({ role: "editor" }) }
    );
    expect(asAdmin.status).toBe(200);

    // The sole owner cannot be demoted or removed.
    const demote = await request(
      "owner",
      `/projects/${suite.projectId}/members/${owner.userId}`,
      { method: "PATCH", body: JSON.stringify({ role: "admin" }) }
    );
    expect(demote.status).toBe(409);

    const selfRemove = await request(
      "owner",
      `/projects/${suite.projectId}/members/${owner.userId}`,
      { method: "DELETE" }
    );
    expect(selfRemove.status).toBe(409);

    // Removing a non-owner member works.
    const removed = await request(
      "owner",
      `/projects/${suite.projectId}/members/${viewer.userId}`,
      { method: "DELETE" }
    );
    expect(removed.status).toBe(204);
    const afterRemoval = await (
      await request("owner", `/projects/${suite.projectId}/members`)
    ).json();
    expect(
      afterRemoval.some((m: { userId: string }) => m.userId === viewer.userId)
    ).toBe(false);

    // Restore the suite's shared roles for the tests that follow.
    await seedMember(viewer, "viewer");
    await request(
      "owner",
      `/projects/${suite.projectId}/members/${editor.userId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ role: "editor" }),
      }
    );
  });

  it("deletes a project, taking its uploads and its contents with it", async () => {
    requireProject();

    // A throwaway project, since deleting the shared one would end the run.
    const created = await request("owner", "/projects", {
      method: "POST",
      body: JSON.stringify({ name: `Doomed Project ${Date.now()}`, links: [] }),
    });
    expect(created.status).toBe(201);
    const doomedId = (await created.json()).id as number;

    const upload = async (route: "assets" | "images") => {
      const form = new FormData();
      form.append(
        "file",
        new File([await testImage()], `doomed-${route}.jpeg`, {
          type: "image/jpeg",
        })
      );
      form.append("projectId", String(doomedId));
      const res = await app.request(`${baseUrl}/${route}/upload`, {
        method: "POST",
        headers: { Cookie: owner.cookie, Origin: trustedOrigin },
        body: form,
      });
      expect(res.status).toBe(201);
      return (await res.json()).id as number;
    };

    const assetId = await upload("assets");
    const imageId = await upload("images");

    const trackRes = await request("owner", "/tracks", {
      method: "POST",
      body: JSON.stringify({
        title: "Doomed Track",
        artists: ["A"],
        projectId: doomedId,
      }),
    });
    expect(trackRes.status).toBe(201);
    const trackId = (await trackRes.json()).id as number;

    const collectionRes = await request("owner", "/collections", {
      method: "POST",
      body: JSON.stringify({ title: "Doomed Collection", projectId: doomedId }),
    });
    expect(collectionRes.status).toBe(201);
    const collectionId = (await collectionRes.json()).id as number;

    const sessionRes = await request("owner", "/sessions", {
      method: "POST",
      body: JSON.stringify({
        name: "Doomed Session",
        daw: "ableton",
        projectId: doomedId,
      }),
    });
    expect(sessionRes.status).toBe(201);
    const sessionId = (await sessionRes.json()).id as number;

    const audioForm = new FormData();
    audioForm.append(
      "file",
      new File([fakeWav], "doomed-audio.wav", { type: "audio/wav" })
    );
    audioForm.append("projectId", String(doomedId));
    const audioUpload = await app.request(`${baseUrl}/assets/upload`, {
      method: "POST",
      headers: { Cookie: owner.cookie, Origin: trustedOrigin },
      body: audioForm,
    });
    expect(audioUpload.status).toBe(201);
    const audioAsset = (await audioUpload.json()) as {
      id: number;
      assetPath: string;
    };
    await makeAudible(audioAsset.assetPath);

    const linkRes = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [audioAsset.id] }),
    });
    expect(linkRes.status).toBe(201);
    await settleJobs((await linkRes.json()).analysisJobIds);

    const [audioRow] = await db
      .select({ spectrogramKey: trackAudios.spectrogramKey })
      .from(trackAudios)
      .where(eq(trackAudios.assetId, audioAsset.id));
    expect(audioRow?.spectrogramKey).toBeTruthy();
    expect(existsSync(onDiskPath(audioRow!.spectrogramKey!))).toBe(true);

    const deleted = await request("owner", `/projects/${doomedId}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");

    // The track's own version cascades away with the project, so the
    // spectrogram PNG it named has to be cleaned up too rather than left
    // behind under `static/analysis/`.
    expect(existsSync(onDiskPath(audioRow!.spectrogramKey!))).toBe(false);

    // Nothing outlives the project. Contents used to be left project-less,
    // which put them outside every membership check.
    expect(
      await db.select().from(assets).where(eq(assets.id, assetId))
    ).toHaveLength(0);
    expect(
      await db.select().from(images).where(eq(images.id, imageId))
    ).toHaveLength(0);

    expect((await request("owner", `/tracks/${trackId}`)).status).toBe(404);
    expect(
      (await request("owner", `/collections/${collectionId}`)).status
    ).toBe(404);
    expect((await request("owner", `/sessions/${sessionId}`)).status).toBe(404);

    expect(
      await db.select().from(tracks).where(eq(tracks.id, trackId))
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(collections)
        .where(eq(collections.id, collectionId))
    ).toHaveLength(0);
    expect(
      await db.select().from(sessions).where(eq(sessions.id, sessionId))
    ).toHaveLength(0);
  });
});

describe("track artists", () => {
  it("lists every artist credited on the project's tracks, most credited first", async () => {
    requireProject();
    // Its own project, so the shared project's tracks stay out of the list.
    const other = await suite.throwawayProject("Artists");
    const credit = async (title: string, artists: string[]) => {
      const res = await requestAs(other.owner, "/tracks", {
        method: "POST",
        body: JSON.stringify({ title, artists, projectId: other.id }),
      });
      expect(res.status).toBe(201);
      return (await res.json()).id as number;
    };
    await credit("Credited twice", ["Marlow Reed", "Ada Vale"]);
    await credit("Credited once", ["Ada Vale"]);
    await credit("Uncredited", []);
    const shelved = await credit("Shelved", ["Iris Hale"]);
    await db
      .update(tracks)
      .set({ archivedAt: new Date() })
      .where(eq(tracks.id, shelved));

    const res = await requestAs(
      other.editor,
      `/projects/${other.id}/tracks/artists`
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(["Ada Vale", "Iris Hale", "Marlow Reed"]);
  });
});

describe("membership ranks", () => {
  /**
   * A throwaway project whose roster is written straight to the table, so a
   * test can start from a shape the API will not produce — a second owner, or
   * an admin who did not climb there through a route. Removed by id at the
   * end, since the actor holding the owner role may have changed by then.
   */
  async function withRoster<T>(
    roster: Record<string, "owner" | "admin" | "editor" | "viewer">,
    run: (rosterProjectId: number) => Promise<T>
  ): Promise<T> {
    const created = await request("owner", "/projects", {
      method: "POST",
      body: JSON.stringify({
        name: `Roster Project ${Date.now()}`,
        links: [],
      }),
    });
    expect(created.status).toBe(201);
    const rosterProjectId = (await created.json()).id as number;

    for (const [userId, role] of Object.entries(roster)) {
      await db
        .insert(members)
        .values({ projectId: rosterProjectId, userId, role })
        .onConflictDoUpdate({
          target: [members.userId, members.projectId],
          set: { role },
        });
    }
    invalidateMembershipCache(undefined, rosterProjectId);

    try {
      return await run(rosterProjectId);
    } finally {
      await db.delete(projects).where(eq(projects.id, rosterProjectId));
      invalidateMembershipCache(undefined, rosterProjectId);
    }
  }

  const ownersOf = (rosterProjectId: number) =>
    db
      .select({ userId: members.userId })
      .from(members)
      .where(
        and(eq(members.projectId, rosterProjectId), eq(members.role, "owner"))
      );

  it("refuses owner as a role the member route can assign", async () => {
    requireProject();
    const admin = await signUpAndSignIn("Rank Self Promoter");

    await withRoster({ [admin.userId]: "admin" }, async (id) => {
      const res = await requestAs(
        admin,
        `/projects/${id}/members/${admin.userId}`,
        { method: "PATCH", body: JSON.stringify({ role: "owner" }) }
      );
      expect(res.status).toBe(400);

      const [stillAdmin] = await db
        .select({ role: members.role })
        .from(members)
        .where(
          and(eq(members.projectId, id), eq(members.userId, admin.userId))
        );
      expect(stillAdmin?.role).toBe("admin");
    });
  });

  it("refuses to change or remove a member who outranks the actor", async () => {
    requireProject();
    const admin = await signUpAndSignIn("Rank Owner Demoter");

    await withRoster({ [admin.userId]: "admin" }, async (id) => {
      const demoted = await requestAs(
        admin,
        `/projects/${id}/members/${owner.userId}`,
        { method: "PATCH", body: JSON.stringify({ role: "editor" }) }
      );
      expect(demoted.status).toBe(403);

      const removed = await requestAs(
        admin,
        `/projects/${id}/members/${owner.userId}`,
        { method: "DELETE" }
      );
      expect(removed.status).toBe(403);

      expect(await ownersOf(id)).toHaveLength(1);
    });
  });

  it("lets an admin remove a peer admin but not an editor remove one", async () => {
    requireProject();
    const first = await signUpAndSignIn("Rank Admin One");
    const second = await signUpAndSignIn("Rank Admin Two");
    const junior = await signUpAndSignIn("Rank Editor");

    await withRoster(
      {
        [first.userId]: "admin",
        [second.userId]: "admin",
        [junior.userId]: "editor",
      },
      async (id) => {
        const byEditor = await requestAs(
          junior,
          `/projects/${id}/members/${first.userId}`,
          { method: "DELETE" }
        );
        expect(byEditor.status).toBe(403);

        const byPeer = await requestAs(
          first,
          `/projects/${id}/members/${second.userId}`,
          { method: "DELETE" }
        );
        expect(byPeer.status).toBe(204);
      }
    );
  });

  it("refuses an invite at a role above the inviter", async () => {
    requireProject();
    const junior = await signUpAndSignIn("Rank Inviter");
    const guest = await signUpAndSignIn("Rank Invitee");

    await withRoster({ [junior.userId]: "editor" }, async (id) => {
      const res = await requestAs(junior, `/projects/${id}/invites`, {
        method: "POST",
        body: JSON.stringify({ email: guest.email, role: "admin" }),
      });
      expect(res.status).toBe(403);
    });
  });

  it("lets a member remove themselves unless they are the last owner", async () => {
    requireProject();
    const leaver = await signUpAndSignIn("Rank Leaver");

    await withRoster({ [leaver.userId]: "admin" }, async (id) => {
      const left = await requestAs(
        leaver,
        `/projects/${id}/members/${leaver.userId}`,
        { method: "DELETE" }
      );
      expect(left.status).toBe(204);

      const lastOwner = await requestAs(
        owner,
        `/projects/${id}/members/${owner.userId}`,
        { method: "DELETE" }
      );
      expect(lastOwner.status).toBe(409);
    });
  });

  it("lets an editor and a viewer leave a project of their own accord", async () => {
    requireProject();
    const quittingEditor = await signUpAndSignIn("Leave Editor");
    const quittingViewer = await signUpAndSignIn("Leave Viewer");

    await withRoster(
      {
        [quittingEditor.userId]: "editor",
        [quittingViewer.userId]: "viewer",
      },
      async (id) => {
        for (const actor of [quittingEditor, quittingViewer]) {
          const left = await requestAs(actor, `/projects/${id}/leave`, {
            method: "POST",
          });
          expect(left.status).toBe(200);

          expect(
            await db
              .select()
              .from(members)
              .where(
                and(eq(members.projectId, id), eq(members.userId, actor.userId))
              )
          ).toHaveLength(0);

          const afterwards = await requestAs(actor, `/projects/${id}`);
          expect(afterwards.status).toBe(404);
        }
      }
    );
  });

  it("refuses to let the last owner leave", async () => {
    requireProject();

    await withRoster({}, async (id) => {
      const res = await requestAs(owner, `/projects/${id}/leave`, {
        method: "POST",
      });
      expect(res.status).toBe(409);
      expect(await ownersOf(id)).toHaveLength(1);
    });
  });

  it("keeps one owner when two of them step down at the same moment", async () => {
    requireProject();
    const coOwner = await signUpAndSignIn("Rank Co-owner");

    await withRoster({ [coOwner.userId]: "owner" }, async (id) => {
      const stepDown = (actor: Actor) =>
        requestAs(actor, `/projects/${id}/members/${actor.userId}`, {
          method: "PATCH",
          body: JSON.stringify({ role: "admin" }),
        });

      const results = await Promise.all([stepDown(owner), stepDown(coOwner)]);
      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);

      expect(await ownersOf(id)).toHaveLength(1);
    });
  });
});

describe("ownership transfer", () => {
  /**
   * A throwaway project owned by `owner`, torn down at the end of the test so
   * ownership transfers do not bleed into the suite's shared project.
   */
  async function withOwnedProject<T>(
    run: (rosterProjectId: number) => Promise<T>
  ): Promise<T> {
    const created = await request("owner", "/projects", {
      method: "POST",
      body: JSON.stringify({
        name: `Transfer Project ${Date.now()}`,
        links: [],
      }),
    });
    expect(created.status).toBe(201);
    const rosterProjectId = (await created.json()).id as number;

    try {
      return await run(rosterProjectId);
    } finally {
      await db.delete(projects).where(eq(projects.id, rosterProjectId));
    }
  }

  /** Adds `actor` to `rosterProjectId` the way a real user joins: invite then accept. */
  async function addMember(
    rosterProjectId: number,
    actor: Actor,
    role: "admin" | "editor" | "viewer"
  ) {
    const invited = await request(
      "owner",
      `/projects/${rosterProjectId}/invites`,
      {
        method: "POST",
        body: JSON.stringify({ email: actor.email, role }),
      }
    );
    expect(invited.status).toBe(201);
    const { token } = await invited.json();

    const accepted = await requestAs(actor, `/invites/${token}/accept`, {
      method: "POST",
    });
    expect(accepted.status).toBe(200);
  }

  it("moves ownership to a member and demotes the caller to admin", async () => {
    requireProject();
    const target = await signUpAndSignIn("Transfer Editor");

    await withOwnedProject(async (id) => {
      await addMember(id, target, "editor");

      const res = await requestAs(owner, `/projects/${id}/transfer-ownership`, {
        method: "POST",
        body: JSON.stringify({ userId: target.userId }),
      });
      expect(res.status).toBe(200);

      const [newOwner] = await db
        .select({ role: members.role })
        .from(members)
        .where(
          and(eq(members.projectId, id), eq(members.userId, target.userId))
        );
      expect(newOwner?.role).toBe("owner");

      const [previousOwner] = await db
        .select({ role: members.role })
        .from(members)
        .where(
          and(eq(members.projectId, id), eq(members.userId, owner.userId))
        );
      expect(previousOwner?.role).toBe("admin");

      const deleted = await requestAs(owner, `/projects/${id}`, {
        method: "DELETE",
      });
      expect(deleted.status).toBe(403);
    });
  });

  it("refuses a caller who is not the owner", async () => {
    requireProject();
    const admin = await signUpAndSignIn("Transfer Admin");
    const target = await signUpAndSignIn("Transfer Target");

    await withOwnedProject(async (id) => {
      await addMember(id, admin, "admin");
      await addMember(id, target, "editor");

      const res = await requestAs(admin, `/projects/${id}/transfer-ownership`, {
        method: "POST",
        body: JSON.stringify({ userId: target.userId }),
      });
      expect(res.status).toBe(403);
    });
  });

  it("refuses to transfer to a user who is not a member", async () => {
    requireProject();
    const outsider = await signUpAndSignIn("Transfer Outsider");

    await withOwnedProject(async (id) => {
      const res = await requestAs(owner, `/projects/${id}/transfer-ownership`, {
        method: "POST",
        body: JSON.stringify({ userId: outsider.userId }),
      });
      expect(res.status).toBe(404);
    });
  });

  it("refuses to transfer ownership to yourself", async () => {
    requireProject();

    await withOwnedProject(async (id) => {
      const res = await requestAs(owner, `/projects/${id}/transfer-ownership`, {
        method: "POST",
        body: JSON.stringify({ userId: owner.userId }),
      });
      expect(res.status).toBe(400);
    });
  });
});

describe("invites", () => {
  it("invites, lists, accepts, and revokes", async () => {
    requireProject();

    const newcomer = await signUpAndSignIn("Suite Newcomer");

    // Creating and listing invites is admin-only.
    await expectAccess(
      "POST",
      `/projects/${suite.projectId}/invites`,
      { viewer: 403, editor: 403 },
      { email: newcomer.email, role: "editor" }
    );
    await expectAccess("GET", `/projects/${suite.projectId}/invites`, {
      viewer: 403,
      editor: 403,
      owner: 200,
    });

    const created = await request(
      "owner",
      `/projects/${suite.projectId}/invites`,
      {
        method: "POST",
        body: JSON.stringify({ email: newcomer.email, role: "editor" }),
      }
    );
    expect(created.status).toBe(201);
    const invite = await created.json();
    expect(invite.token).toBeTypeOf("string");

    const pending = await (
      await request("owner", `/projects/${suite.projectId}/invites`)
    ).json();
    expect(pending.some((i: { id: number }) => i.id === invite.id)).toBe(true);

    const accept = await app.request(
      `${baseUrl}/invites/${invite.token}/accept`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: newcomer.cookie,
        },
      }
    );
    expect(accept.status).toBe(200);

    // The newcomer is now an editor and can hit editor-gated routes.
    const asMember = await app.request(
      `${baseUrl}/projects/${suite.projectId}`,
      {
        headers: { Cookie: newcomer.cookie },
      }
    );
    expect(asMember.status).toBe(200);

    // Accepting it again fails, and it no longer shows as pending.
    const reaccept = await app.request(
      `${baseUrl}/invites/${invite.token}/accept`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: newcomer.cookie,
        },
      }
    );
    expect(reaccept.status).toBe(409);

    const stillPending = await (
      await request("owner", `/projects/${suite.projectId}/invites`)
    ).json();
    expect(stillPending.some((i: { id: number }) => i.id === invite.id)).toBe(
      false
    );

    // Clean up the newcomer's membership so the shared project's roster is
    // back to the suite's four actors.
    await request(
      "owner",
      `/projects/${suite.projectId}/members/${newcomer.userId}`,
      { method: "DELETE" }
    );
  });

  it("exposes a public preview of an invite by token", async () => {
    requireProject();
    const guest = await signUpAndSignIn("Suite Previewee");

    const created = await request(
      "owner",
      `/projects/${suite.projectId}/invites`,
      {
        method: "POST",
        body: JSON.stringify({ email: guest.email, role: "viewer" }),
      }
    );
    const invite = await created.json();

    // No credentials at all — the acceptance page reads this before sign-in.
    const preview = await app.request(`${baseUrl}/invites/${invite.token}`);
    expect(preview.status).toBe(200);
    const body = await preview.json();
    expect(body).toMatchObject({
      role: "viewer",
      projectName: expect.any(String),
      email: guest.email,
      expired: false,
      accepted: false,
    });

    const missing = await app.request(`${baseUrl}/invites/does-not-exist`);
    expect(missing.status).toBe(404);

    await request("owner", `/invites/${invite.id}`, { method: "DELETE" });
  });

  it("refuses to invite someone who is already a member", async () => {
    requireProject();
    const res = await request("owner", `/projects/${suite.projectId}/invites`, {
      method: "POST",
      body: JSON.stringify({ email: editor.email, role: "viewer" }),
    });
    expect(res.status).toBe(409);
  });

  it("revokes a pending invite (admin only)", async () => {
    requireProject();
    const target = await signUpAndSignIn("Suite Revokee");

    const created = await request(
      "owner",
      `/projects/${suite.projectId}/invites`,
      {
        method: "POST",
        body: JSON.stringify({ email: target.email, role: "viewer" }),
      }
    );
    const invite = await created.json();

    await expectAccess("DELETE", `/invites/${invite.id}`, {
      viewer: 403,
      editor: 403,
    });

    const revoked = await request("owner", `/invites/${invite.id}`, {
      method: "DELETE",
    });
    expect(revoked.status).toBe(204);

    const accept = await app.request(
      `${baseUrl}/invites/${invite.token}/accept`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: target.cookie },
      }
    );
    expect(accept.status).toBe(404);
  });

  it("redeems a token once when two requests race", async () => {
    requireProject();
    const racer = await signUpAndSignIn("Suite Racer");

    const created = await request(
      "owner",
      `/projects/${suite.projectId}/invites`,
      {
        method: "POST",
        body: JSON.stringify({ email: racer.email, role: "viewer" }),
      }
    );
    expect(created.status).toBe(201);
    const invite = await created.json();

    const accept = () =>
      requestAs(racer, `/invites/${invite.token}/accept`, { method: "POST" });
    const results = await Promise.all([accept(), accept()]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);

    await request(
      "owner",
      `/projects/${suite.projectId}/members/${racer.userId}`,
      {
        method: "DELETE",
      }
    );
  });

  it("refuses an expired token", async () => {
    requireProject();
    const latecomer = await signUpAndSignIn("Suite Latecomer");

    const created = await request(
      "owner",
      `/projects/${suite.projectId}/invites`,
      {
        method: "POST",
        body: JSON.stringify({ email: latecomer.email, role: "viewer" }),
      }
    );
    expect(created.status).toBe(201);
    const invite = await created.json();

    await db
      .update(invites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invites.id, invite.id));

    const accepted = await requestAs(
      latecomer,
      `/invites/${invite.token}/accept`,
      { method: "POST" }
    );
    expect(accepted.status).toBe(410);

    const preview = await app.request(`${baseUrl}/invites/${invite.token}`);
    expect((await preview.json()).expired).toBe(true);

    await request("owner", `/invites/${invite.id}`, { method: "DELETE" });
  });

  it("refuses an editor 403 forbidden while only admins may invite, which is the default", async () => {
    requireProject();
    const invitee = await signUpAndSignIn("Suite Editor Invitee");

    const res = await request(
      "editor",
      `/projects/${suite.projectId}/invites`,
      {
        method: "POST",
        body: JSON.stringify({ email: invitee.email, role: "viewer" }),
      }
    );

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("forbidden");
  });

  it("lets an editor invite where the project allows it, with its default role and lifetime", async () => {
    requireProject();
    const invitee = await signUpAndSignIn("Suite Defaulted Invitee");

    const res = await withProjectPolicyForTest(
      suite.projectId,
      {
        sharing: {
          whoMayInvite: "editor",
          inviteRole: "editor",
          inviteDays: 2,
        },
      },
      () =>
        request("editor", `/projects/${suite.projectId}/invites`, {
          method: "POST",
          body: JSON.stringify({ email: invitee.email }),
        })
    );

    expect(res.status).toBe(201);
    const invite = (await res.json()) as {
      id: number;
      role: string;
      expiresAt: string;
    };
    expect(invite.role).toBe("editor");
    const lifetime = new Date(invite.expiresAt).getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(2 * 24 * 60 * 60 * 1000 - 60_000);
    expect(lifetime).toBeLessThanOrEqual(2 * 24 * 60 * 60 * 1000);

    await request("owner", `/invites/${invite.id}`, { method: "DELETE" });
  });

  it("refuses an admin 403 forbidden when only the owner may invite, and leaves existing invites alone", async () => {
    requireProject();
    const admin = await signUpAndSignIn("Suite Invite Admin");
    await seedMember(admin, "admin");
    const earlier = await signUpAndSignIn("Suite Earlier Invitee");
    const created = await request(
      "owner",
      `/projects/${suite.projectId}/invites`,
      {
        method: "POST",
        body: JSON.stringify({ email: earlier.email, role: "viewer" }),
      }
    );
    const invite = (await created.json()) as { id: number };
    const later = await signUpAndSignIn("Suite Refused Invitee");

    await withProjectPolicyForTest(
      suite.projectId,
      { sharing: { whoMayInvite: "owner" } },
      async () => {
        const refused = await requestAs(
          admin,
          `/projects/${suite.projectId}/invites`,
          {
            method: "POST",
            body: JSON.stringify({ email: later.email, role: "viewer" }),
          }
        );
        expect(refused.status).toBe(403);
        expect((await refused.json()).code).toBe("forbidden");

        const byOwner = await request(
          "owner",
          `/projects/${suite.projectId}/invites`,
          {
            method: "POST",
            body: JSON.stringify({ email: later.email, role: "viewer" }),
          }
        );
        expect(byOwner.status).toBe(201);
      }
    );

    const pending = (await (
      await request("owner", `/projects/${suite.projectId}/invites`)
    ).json()) as { id: number; email: string }[];
    expect(pending.map((i) => i.id)).toContain(invite.id);

    await request(
      "owner",
      `/projects/${suite.projectId}/members/${admin.userId}`,
      { method: "DELETE" }
    );
  });
});

describe("search", () => {
  it("finds a track for a member and gates access like every other project read", async () => {
    requireProject();

    const created = await request("owner", "/tracks", {
      method: "POST",
      body: JSON.stringify({
        title: "Search Route Marker Track",
        artists: [],
        projectId: suite.projectId,
      }),
    });
    expect(created.status).toBe(201);

    await expectAccess(
      "GET",
      `/projects/${suite.projectId}/search?q=Search Route Marker`,
      { viewer: 200, editor: 200, owner: 200 }
    );

    const found = await (
      await request(
        "viewer",
        `/projects/${suite.projectId}/search?q=Search Route Marker`
      )
    ).json();
    expect(
      found.some(
        (r: { title: string }) => r.title === "Search Route Marker Track"
      )
    ).toBe(true);
  });

  it("returns an empty array rather than an error for an empty q", async () => {
    requireProject();
    const res = await request(
      "viewer",
      `/projects/${suite.projectId}/search?q=`
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("filters by types", async () => {
    requireProject();
    const res = await request(
      "viewer",
      `/projects/${suite.projectId}/search?q=Search Route Marker&types=collection`
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("caps a limit above the most it gives rather than refusing it", async () => {
    requireProject();
    const res = await request(
      "viewer",
      `/projects/${suite.projectId}/search?q=Search Route Marker&limit=${MAX_SEARCH_LIMIT + 50}`
    );
    expect(res.status).toBe(200);
    const found = await res.json();
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThanOrEqual(MAX_SEARCH_LIMIT);
  });

  it("still refuses a limit below one", async () => {
    requireProject();
    const res = await request(
      "viewer",
      `/projects/${suite.projectId}/search?q=Search Route Marker&limit=0`
    );
    expect(res.status).toBe(400);
  });

  it("appears in the OpenAPI spec", async () => {
    const res = await app.request(`${baseUrl}/openapi`);
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.paths).toHaveProperty("/api/projects/{id}/search");
  });
});

describe("paginated project lists", () => {
  type GroupSummary = { key: string; label: string; count: number };
  type Page<T> = {
    rows: T[];
    rowCount: number;
    page: number;
    pageSize: number;
    groups: GroupSummary[];
  };

  const getPage = async <T>(
    entity: "tracks" | "collections" | "sessions",
    qs: string
  ): Promise<Page<T>> => {
    const res = await request(
      "owner",
      `/projects/${suite.projectId}/${entity}/paginated${qs ? `?${qs}` : ""}`
    );
    expect(res.status, `${entity} ${qs}`).toBe(200);
    return res.json();
  };

  it("returns a bounded page and a full-set rowCount", async () => {
    requireProject();

    const titles = ["pg-a", "pg-b", "pg-c", "pg-d", "pg-e"];
    for (const t of titles) await mkTrack(t);

    const first = await getPage<{ id: number; title: string }>(
      "tracks",
      "pageSize=2&sort=title.asc&q=pg-"
    );
    expect(first.rows).toHaveLength(2);
    expect(first.rows.map((r) => r.title)).toEqual(["pg-a", "pg-b"]);
    expect(first.rowCount).toBe(5);
    expect(first.page).toBe(1);
    expect(first.pageSize).toBe(2);

    const third = await getPage<{ title: string }>(
      "tracks",
      "page=3&pageSize=2&sort=title.asc&q=pg-"
    );
    expect(third.rows.map((r) => r.title)).toEqual(["pg-e"]);
    expect(third.rowCount).toBe(5);
  });

  /*
   * The listing rows are deliberately narrower than the detail responses: a
   * page of fifty rows must not carry fifty notes documents, comment threads,
   * attachment lists or audio rows for cells that no column renders. These
   * assert both halves — the fields the tables read are present, and the
   * detail-only ones are gone.
   */
  it("returns list-shaped track rows, not detail-shaped ones", async () => {
    requireProject();

    const trackId = await mkTrack("shape-track");
    const collectionId = await mkCollection("shape-collection");
    await request("owner", `/collections/${collectionId}/tracks`, {
      method: "POST",
      body: JSON.stringify({ trackId }),
    });
    await mkSession({ name: "shape-session", trackId, main: true });
    const asset = await uploadAsset("shape-track-audio.wav");
    await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [asset.id] }),
    });

    const page = await getPage<Record<string, unknown>>(
      "tracks",
      "q=shape-track"
    );
    const row = page.rows.find((r) => r.id === trackId)!;
    expect(row).toBeDefined();

    for (const key of [
      "title",
      "artists",
      "priority",
      "image",
      "isrc",
      "iswc",
      "status",
      "collections",
      "sessions",
      "relations",
      "labels",
      "key",
      "bpm",
    ]) {
      expect(row, key).toHaveProperty(key);
    }
    for (const key of [
      "notes",
      "notesText",
      "attachments",
      "audios",
      "primaryAudio",
    ]) {
      expect(row, key).not.toHaveProperty(key);
    }

    const rowCollection = (row.collections as Record<string, unknown>[])[0]!;
    expect(Object.keys(rowCollection).sort()).toEqual(["id", "image", "title"]);

    // The detail response still carries everything the page dropped.
    const detail = await (await request("owner", `/tracks/${trackId}`)).json();
    expect(detail).toHaveProperty("audios");
    expect(detail).toHaveProperty("attachments");
    expect(detail).toHaveProperty("notes");
  });

  it("returns list-shaped collection rows with track sub-rows only", async () => {
    requireProject();

    const collectionId = await mkCollection("shape-coll-rows");
    const trackId = await mkTrack("shape-coll-track");
    await request("owner", `/collections/${collectionId}/tracks`, {
      method: "POST",
      body: JSON.stringify({ trackId }),
    });

    const page = await getPage<Record<string, unknown>>(
      "collections",
      "q=shape-coll-rows"
    );
    const row = page.rows.find((r) => r.id === collectionId)!;
    expect(row).toBeDefined();

    for (const key of [
      "title",
      "status",
      "tracks",
      "labels",
      "releaseDate",
      "upc",
    ]) {
      expect(row, key).toHaveProperty(key);
    }
    for (const key of ["notes", "notesText", "comments", "attachments"]) {
      expect(row, key).not.toHaveProperty(key);
    }

    const subRow = (row.tracks as Record<string, unknown>[])[0]!;
    expect(Object.keys(subRow).sort()).toEqual([
      "id",
      "image",
      "priority",
      "title",
    ]);
  });

  it("returns list-shaped session rows carrying only the parent track's names", async () => {
    requireProject();

    const trackId = await mkTrack("shape-session-track");
    const collectionId = await mkCollection("shape-session-coll");
    await request("owner", `/collections/${collectionId}/tracks`, {
      method: "POST",
      body: JSON.stringify({ trackId }),
    });
    const session = await mkSession({ name: "shape-sess", trackId });

    const page = await getPage<Record<string, unknown>>(
      "sessions",
      "q=shape-sess"
    );
    const row = page.rows.find((r) => r.id === session.id)!;
    expect(row).toBeDefined();

    for (const key of [
      "name",
      "daw",
      "track",
      "labels",
      "tempo",
      "localFilepath",
    ]) {
      expect(row, key).toHaveProperty(key);
    }
    for (const key of [
      "notes",
      "notesText",
      "samplePaths",
      "comments",
      "attachments",
    ]) {
      expect(row, key).not.toHaveProperty(key);
    }

    const track = row.track as Record<string, unknown>;
    expect(Object.keys(track).sort()).toEqual(["collections", "id", "title"]);
    const trackCollection = (
      track.collections as Record<string, unknown>[]
    )[0]!;
    expect(Object.keys(trackCollection).sort()).toEqual(["id", "title"]);
  });

  it("returns an empty page past the end, keeping the true rowCount", async () => {
    requireProject();

    const page = await getPage<unknown>("tracks", "page=999&pageSize=25&q=pg-");
    expect(page.rows).toHaveLength(0);
    expect(page.rowCount).toBeGreaterThanOrEqual(5);
  });

  it("orders by id as a tiebreaker so a page boundary is stable", async () => {
    requireProject();

    // Same sort value (equal titles) across the boundary: without the id
    // tiebreaker the two middle rows could swap between the pages.
    const tie = ["tie", "tie", "tie", "tie"];
    const ids: number[] = [];
    for (const t of tie) ids.push(await mkTrack(t));
    ids.sort((a, b) => a - b);

    const p1 = await getPage<{ id: number }>(
      "tracks",
      "pageSize=2&sort=title.asc&q=tie"
    );
    const p2 = await getPage<{ id: number }>(
      "tracks",
      "page=2&pageSize=2&sort=title.asc&q=tie"
    );
    expect([...p1.rows, ...p2.rows].map((r) => r.id)).toEqual(ids);
  });

  it("patches a track's priority level and sorts by the scale's rank both ways", async () => {
    requireProject();
    const levels = await levelIds();

    const low = await mkTrack("prio-low");
    const urgent = await mkTrack("prio-urgent");
    const medium = await mkTrack("prio-medium");

    for (const [id, name] of [
      [low, "Low"],
      [urgent, "Urgent"],
      [medium, "Medium"],
    ] as const) {
      const res = await request("owner", `/tracks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ priorityId: levels[name] }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).priorityId).toBe(levels[name]!);
    }

    const names = async (direction: "asc" | "desc") =>
      (
        await getPage<{ priority: { name: string } }>(
          "tracks",
          `sort=priority.${direction}&q=prio-`
        )
      ).rows.map((r) => r.priority.name);
    expect(await names("desc")).toEqual(["Urgent", "Medium", "Low"]);
    expect(await names("asc")).toEqual(["Low", "Medium", "Urgent"]);
  });

  it("refuses a priority level the project does not have with a 400", async () => {
    requireProject();
    const id = await mkTrack("prio-bad");
    const elsewhere = await throwawayProject("PrioElsewhere");
    const foreign = await levelIds(elsewhere.id, elsewhere.owner);

    for (const priorityId of [foreign.High!, 2_000_000_000]) {
      const res = await request("owner", `/tracks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ priorityId }),
      });
      expect(res.status).toBe(400);
    }
    const detail = await (await request("owner", `/tracks/${id}`)).json();
    expect(detail.priority.name).toBe("None");
  });

  it("ignores a sort key that is not whitelisted", async () => {
    requireProject();

    // `notes` is a real column but not a permitted sort key — the request must
    // still succeed (falling back to the default order) rather than error or
    // interpolate the string into ORDER BY.
    const res = await request(
      "owner",
      `/projects/${suite.projectId}/tracks/paginated?sort=notes.asc`
    );
    expect(res.status).toBe(200);
    const evil = await request(
      "owner",
      `/projects/${suite.projectId}/tracks/paginated?sort=${encodeURIComponent(
        "title; drop table tracks"
      )}.asc`
    );
    expect(evil.status).toBe(200);
  });

  it("filters tracks by status and collection membership", async () => {
    requireProject();

    const status = await mkStatus("Paginated");
    const trackId = await mkTrack("filter-target");
    await request("owner", `/tracks/${trackId}`, {
      method: "PATCH",
      body: JSON.stringify({ statusId: status.id }),
    });
    const collectionId = await mkCollection("filter-collection");
    await request("owner", `/collections/${collectionId}/tracks`, {
      method: "POST",
      body: JSON.stringify({ trackId }),
    });

    const byStatus = await getPage<{ id: number }>(
      "tracks",
      `status=${status.id}`
    );
    expect(byStatus.rows.map((r) => r.id)).toContain(trackId);
    expect(byStatus.rows.every((r) => r.id === trackId)).toBe(true);

    const byCollection = await getPage<{ id: number }>(
      "tracks",
      `collection=${collectionId}`
    );
    expect(byCollection.rows.map((r) => r.id)).toEqual([trackId]);
  });

  it("sorts tracks by a joined status value", async () => {
    requireProject();

    const low = await mkStatus("JoinLow", 10);
    const high = await mkStatus("JoinHigh", 90);
    const lowT = await mkTrack("join-sort-low");
    const highT = await mkTrack("join-sort-high");
    for (const [t, s] of [
      [lowT, low.id],
      [highT, high.id],
    ] as const) {
      await request("owner", `/tracks/${t}`, {
        method: "PATCH",
        body: JSON.stringify({ statusId: s }),
      });
    }

    const asc = await getPage<{ id: number }>(
      "tracks",
      "sort=status.asc&q=join-sort-"
    );
    const ids = asc.rows.map((r) => r.id);
    expect(ids.indexOf(lowT)).toBeLessThan(ids.indexOf(highT));
  });

  it("sorts tracks by bpm via the main session tempo", async () => {
    requireProject();

    const slow = await mkTrack("bpm-sort-slow");
    const fast = await mkTrack("bpm-sort-fast");
    await mkSession({ trackId: slow, main: true, tempo: "70" });
    await mkSession({ trackId: fast, main: true, tempo: "180" });

    const asc = await getPage<{ id: number; bpm: string | null }>(
      "tracks",
      "sort=bpm.asc&q=bpm-sort-"
    );
    const ids = asc.rows.map((r) => r.id);
    expect(ids.indexOf(slow)).toBeLessThan(ids.indexOf(fast));
    expect(asc.rows.find((r) => r.id === fast)?.bpm).toBe("180");
  });

  it("sorts grouped tracks by a joined status value", async () => {
    requireProject();

    const low = await mkStatus("GroupedJoinLow", 10);
    const high = await mkStatus("GroupedJoinHigh", 90);
    const highT = await mkTrack("grouped-join-high");
    const lowT = await mkTrack("grouped-join-low");
    for (const [t, s] of [
      [lowT, low.id],
      [highT, high.id],
    ] as const) {
      await request("owner", `/tracks/${t}`, {
        method: "PATCH",
        body: JSON.stringify({ statusId: s }),
      });
    }

    const page = await getPage<{ id: number }>(
      "tracks",
      "sort=status.asc&groupBy=priority&q=grouped-join-"
    );
    expect(page.rows.map((r) => r.id)).toEqual([lowT, highT]);
  });

  it("sorts grouped sessions by their track's title", async () => {
    requireProject();

    const zed = await mkTrack("grouped-track-zed");
    const abe = await mkTrack("grouped-track-abe");
    const onZed = await mkSession({ name: "gts-zed", trackId: zed });
    const onAbe = await mkSession({ name: "gts-abe", trackId: abe });

    const page = await getPage<{ id: number }>(
      "sessions",
      "sort=track.asc&groupBy=daw&q=gts-"
    );
    expect(page.rows.map((r) => r.id)).toEqual([onAbe.id, onZed.id]);
  });

  it("sorts grouped sessions by track when grouped by that track too", async () => {
    requireProject();

    const trackId = await mkTrack("grouped-same-join");
    const session = await mkSession({ name: "gsj-one", trackId });

    const page = await getPage<{ id: number }>(
      "sessions",
      "sort=track.desc&groupBy=track&q=gsj-"
    );
    expect(page.rows.map((r) => r.id)).toEqual([session.id]);
  });

  it("sorts grouped collections by a joined status value", async () => {
    requireProject();

    const low = await mkStatus("GroupedCollLow", 10);
    const high = await mkStatus("GroupedCollHigh", 90);
    const highC = await mkCollection("grouped-coll-high");
    const lowC = await mkCollection("grouped-coll-low");
    for (const [c, s] of [
      [lowC, low.id],
      [highC, high.id],
    ] as const) {
      await request("owner", `/collections/${c}`, {
        method: "PATCH",
        body: JSON.stringify({ statusId: s }),
      });
    }

    const page = await getPage<{ id: number }>(
      "collections",
      "sort=status.asc&groupBy=priority&q=grouped-coll-"
    );
    expect(page.rows.map((r) => r.id)).toEqual([lowC, highC]);
  });

  it("puts tracks with no bpm last in both directions, plain and grouped", async () => {
    requireProject();

    const none = await mkTrack("bpm-nulls-none");
    const slow = await mkTrack("bpm-nulls-slow");
    const fast = await mkTrack("bpm-nulls-fast");
    await mkSession({ trackId: slow, main: true, tempo: "70" });
    await mkSession({ trackId: fast, main: true, tempo: "180" });

    const ids = async (qs: string) =>
      (await getPage<{ id: number }>("tracks", `${qs}&q=bpm-nulls-`)).rows.map(
        (r) => r.id
      );
    expect(await ids("sort=bpm.desc")).toEqual([fast, slow, none]);
    expect(await ids("sort=bpm.asc")).toEqual([slow, fast, none]);
    expect(await ids("sort=bpm.desc&groupBy=priority")).toEqual([
      fast,
      slow,
      none,
    ]);
  });

  it("sorts tracks by their main session's track count, plain and grouped", async () => {
    requireProject();

    const none = await mkTrack("tracks-count-none");
    const few = await mkTrack("tracks-count-few");
    const many = await mkTrack("tracks-count-many");
    await mkSession({ trackId: few, main: true, tracksCount: 8 });
    await mkSession({ trackId: many, main: true, tracksCount: 24 });

    const ids = async (qs: string) =>
      (
        await getPage<{ id: number }>("tracks", `${qs}&q=tracks-count-`)
      ).rows.map((r) => r.id);
    expect(await ids("sort=tracks.asc")).toEqual([few, many, none]);
    expect(await ids("sort=tracks.desc&groupBy=priority")).toEqual([
      many,
      few,
      none,
    ]);
  });

  it("puts never-saved tracks last when sorting by last save descending", async () => {
    requireProject();

    const never = await mkTrack("last-save-nulls-never");
    const older = await mkTrack("last-save-nulls-older");
    const newer = await mkTrack("last-save-nulls-newer");
    for (const [trackId, at] of [
      [older, "2026-01-01T00:00:00.000Z"],
      [newer, "2026-02-01T00:00:00.000Z"],
    ] as const) {
      const session = await mkSession({ trackId, main: true });
      await db.insert(saves).values({
        sessionId: session.id,
        projectId: suite.projectId,
        fileUpdatedAt: new Date(at),
        source: "scan",
      });
    }

    const page = await getPage<{ id: number }>(
      "tracks",
      "sort=lastSaveAt.desc&q=last-save-nulls-"
    );
    expect(page.rows.map((r) => r.id)).toEqual([newer, older, never]);
  });

  it("puts collections with no UPC last when sorting by it descending", async () => {
    requireProject();

    const none = await mkCollection("upc-nulls-none");
    const low = await mkCollection("upc-nulls-low");
    const high = await mkCollection("upc-nulls-high");
    for (const [c, upc] of [
      [low, "100000000000"],
      [high, "900000000000"],
    ] as const) {
      const res = await request("owner", `/collections/${c}`, {
        method: "PATCH",
        body: JSON.stringify({ upc }),
      });
      expect(res.status).toBe(200);
    }

    const page = await getPage<{ id: number }>(
      "collections",
      "sort=upc.desc&q=upc-nulls-"
    );
    expect(page.rows.map((r) => r.id)).toEqual([high, low, none]);
  });

  it("filters sessions by daw and by track", async () => {
    requireProject();

    const trackId = await mkTrack("session-filter-track");
    await mkSession({ name: "sf-ableton", daw: "ableton", trackId });
    await mkSession({ name: "sf-logic", daw: "logic-pro", trackId });

    const byDaw = await getPage<{ name: string }>(
      "sessions",
      "daw=logic-pro&q=sf-"
    );
    expect(byDaw.rows.map((r) => r.name)).toContain("sf-logic");
    expect(byDaw.rows.every((r) => r.name !== "sf-ableton")).toBe(true);

    const byTrack = await getPage<{ trackId: number | null }>(
      "sessions",
      `track=${trackId}`
    );
    expect(byTrack.rowCount).toBe(2);
    expect(byTrack.rows.every((r) => r.trackId === trackId)).toBe(true);
  });

  it("groups tracks by status: rows ordered by group, previewed, counts full", async () => {
    requireProject();

    const early = await mkStatus("GroupEarly", 20);
    const late = await mkStatus("GroupLate", 80);

    const earlyIds: number[] = [];
    for (let i = 0; i < 12; i++) {
      const id = await mkTrack(`grp-early-${i}`);
      await request("owner", `/tracks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ statusId: early.id }),
      });
      earlyIds.push(id);
    }
    const lateId = await mkTrack("grp-late-0");
    await request("owner", `/tracks/${lateId}`, {
      method: "PATCH",
      body: JSON.stringify({ statusId: late.id }),
    });

    const page = await getPage<{ id: number; statusId: number | null }>(
      "tracks",
      "groupBy=status&q=grp-"
    );

    const earlyGroup = page.groups.find((g) => g.key === String(early.id));
    const lateGroup = page.groups.find((g) => g.key === String(late.id));
    expect(earlyGroup?.label).toBe(early.name);
    // The summary counts the whole group, not just the previewed rows.
    expect(earlyGroup?.count).toBe(12);
    expect(lateGroup?.count).toBe(1);

    // Groups are ordered by status percentage: early (20) before late (80).
    const keyOrder = page.groups.map((g) => g.key);
    expect(keyOrder.indexOf(String(early.id))).toBeLessThan(
      keyOrder.indexOf(String(late.id))
    );

    // Each group contributes at most the preview size; the rows arrive grouped.
    const earlyRows = page.rows.filter((r) => r.statusId === early.id);
    expect(earlyRows.length).toBe(10);
    const firstLate = page.rows.findIndex((r) => r.statusId === late.id);
    const lastEarly = page.rows.map((r) => r.statusId).lastIndexOf(early.id);
    expect(lastEarly).toBeLessThan(firstLate);
  });

  it("returns no groups when groupBy is absent or unknown", async () => {
    requireProject();
    const plain = await getPage<unknown>("tracks", "q=grp-");
    expect(plain.groups).toEqual([]);
    const bogus = await getPage<unknown>("tracks", "groupBy=nonsense&q=grp-");
    expect(bogus.groups).toEqual([]);
  });

  it("treats a groupBy naming an Object.prototype member as unknown on every list", async () => {
    requireProject();
    for (const entity of ["tracks", "collections", "sessions"] as const) {
      for (const key of ["constructor", "toString", "__proto__"]) {
        const page = await getPage<unknown>(entity, `groupBy=${key}`);
        expect(page.groups, `${entity} groupBy=${key}`).toEqual([]);
      }
    }
  });

  it("gates the paginated routes behind project membership", async () => {
    requireProject();

    for (const entity of ["tracks", "collections", "sessions"] as const) {
      const path = `/projects/${suite.projectId}/${entity}/paginated`;
      expect((await request("anonymous", path)).status).toBe(401);
      expect((await request("outsider", path)).status).toBe(404);
      expect((await request("viewer", path)).status).toBe(200);
    }
  });
});

describe("activity trail", () => {
  /** The project feed scoped to one entity, newest first. */
  async function entityFeed(entityType: string, entityId: number) {
    const res = await request(
      "owner",
      `/projects/${suite.projectId}/activity?entityType=${entityType}&entityId=${entityId}`
    );
    expect(res.status).toBe(200);
    return (await res.json()) as {
      action: string;
      changes: Record<string, { from: unknown; to: unknown }> | null;
    }[];
  }

  it("records create, update (with a field diff), and delete for a track", async () => {
    requireProject();

    const created = await request("owner", "/tracks", {
      method: "POST",
      body: JSON.stringify({
        title: "Trail Track",
        artists: ["A"],
        projectId: suite.projectId,
      }),
    });
    const track = await created.json();
    const levels = await levelIds();

    await request("owner", `/tracks/${track.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: "Trail Renamed",
        priorityId: levels.High,
      }),
    });

    // A no-op patch writes no activity row.
    await request("owner", `/tracks/${track.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "Trail Renamed" }),
    });

    await request("owner", `/tracks/${track.id}`, { method: "DELETE" });

    const feed = await (
      await request(
        "owner",
        `/projects/${suite.projectId}/activity?entityType=track&entityId=${track.id}`
      )
    ).json();

    const actions = feed.map((a: { action: string }) => a.action);
    expect(actions).toEqual(["deleted", "updated", "created"]);

    const updated = feed.find(
      (a: { action: string }) => a.action === "updated"
    );
    expect(updated.changes.title).toEqual({
      from: "Trail Track",
      to: "Trail Renamed",
    });
    expect(updated.changes.priorityId).toEqual({
      from: levels.None,
      to: levels.High,
    });
    expect(updated.user?.id).toBe(owner.userId);
    // The feed names who acted, not how to reach them.
    expect(updated.user).not.toHaveProperty("email");

    // The delete row survives the track being gone.
    expect(feed[0].action).toBe("deleted");
    expect(feed[0].entityId).toBe(track.id);
  });

  it("scopes the project feed and gates it by role", async () => {
    requireProject();
    const before = await (
      await request("owner", `/projects/${suite.projectId}/activity`)
    ).json();

    await request("owner", "/collections", {
      method: "POST",
      body: JSON.stringify({
        title: "Feed Collection",
        projectId: suite.projectId,
      }),
    });

    const after = await (
      await request("owner", `/projects/${suite.projectId}/activity?limit=5`)
    ).json();
    expect(after.length).toBeGreaterThan(0);
    expect(after.length).toBeLessThanOrEqual(5);
    expect(after[0].action).toBe("created");
    expect(after[0].entityType).toBe("collection");
    expect(after.length).toBeGreaterThanOrEqual(Math.min(before.length + 1, 5));

    await expectAccess("GET", `/projects/${suite.projectId}/activity`, {
      viewer: 200,
    });
  });

  it("quotes a comment, keeps the quote current, and drops it with the comment", async () => {
    requireProject();

    const track = await (
      await request("owner", "/tracks", {
        method: "POST",
        body: JSON.stringify({
          title: "Quoted Track",
          artists: ["A"],
          projectId: suite.projectId,
        }),
      })
    ).json();

    const comment = await (
      await request("owner", "/comments", {
        method: "POST",
        body: JSON.stringify({
          targetType: "track",
          targetId: track.id,
          content: "Bridge needs another bar of air before the drop.",
        }),
      })
    ).json();

    const feedFor = async () =>
      (await (
        await request(
          "owner",
          `/projects/${suite.projectId}/activity?entityType=track&entityId=${track.id}`
        )
      ).json()) as {
        action: string;
        entityName: string | null;
        comment: { excerpt: string; positionMs: number | null } | null;
      }[];

    const [entry] = await feedFor();
    expect(entry!.action).toBe("commented");
    expect(entry!.entityName).toBe("Quoted Track");
    expect(entry!.comment).toEqual({
      excerpt: "Bridge needs another bar of air before the drop.",
      positionMs: null,
    });

    // The excerpt is read at query time, so an edit is reflected.
    await request("owner", `/comments/${comment.id}`, {
      method: "PATCH",
      body: JSON.stringify({ content: "Second verse needs more air." }),
    });
    expect((await feedFor())[0]!.comment!.excerpt).toBe(
      "Second verse needs more air."
    );

    // Deleting the comment cascades its activity row away.
    await request("owner", `/comments/${comment.id}`, { method: "DELETE" });
    expect((await feedFor()).some((a) => a.action === "commented")).toBe(false);
  });

  it("records a label set as the before/after name lists", async () => {
    requireProject();
    const trackId = await mkTrack("Activity Label Track");

    const set = await request("owner", `/tracks/${trackId}/labels`, {
      method: "PUT",
      body: JSON.stringify({ names: ["needs mix"] }),
    });
    expect(set.status).toBe(200);

    const updated = (await entityFeed("track", trackId)).find(
      (a) => a.action === "updated"
    );
    expect(updated!.changes!.labels).toEqual({
      from: [],
      to: ["needs mix"],
    });
  });

  it("records adding a track to a collection as the tracklist before/after", async () => {
    requireProject();
    const collectionId = await mkCollection("Activity Tracklist Collection");
    const trackId = await mkTrack("Activity Tracklist Track");

    const added = await request(
      "owner",
      `/collections/${collectionId}/tracks`,
      { method: "POST", body: JSON.stringify({ trackId }) }
    );
    expect(added.status).toBe(200);

    const updated = (await entityFeed("collection", collectionId)).find(
      (a) => a.action === "updated"
    );
    expect(updated!.changes!.tracks).toEqual({
      from: [],
      to: ["Activity Tracklist Track"],
    });
  });

  it("records a status rename on the project", async () => {
    requireProject();
    const status = await mkStatus("Activity Mixing", 40);

    const renamed = await request("owner", `/statuses/${status.id}`, {
      method: "PATCH",
      body: JSON.stringify({ percentage: 60 }),
    });
    expect(renamed.status).toBe(200);

    const updated = (await entityFeed("project", suite.projectId)).find(
      (a) => a.action === "updated"
    );
    expect(updated!.changes!.status).toEqual({
      from: `${status.name} 40%`,
      to: `${status.name} 60%`,
    });
  });

  it("records one activity row per track a bulk patch touches", async () => {
    requireProject();
    const first = await mkTrack("Activity Bulk One");
    const second = await mkTrack("Activity Bulk Two");
    const levels = await levelIds();

    const bulk = await request("owner", "/tracks/bulk", {
      method: "PATCH",
      body: JSON.stringify({
        projectId: suite.projectId,
        selection: { ids: [first, second] },
        patch: { priorityId: levels.High },
      }),
    });
    expect(bulk.status).toBe(200);

    for (const trackId of [first, second]) {
      const updated = (await entityFeed("track", trackId)).find(
        (a) => a.action === "updated"
      );
      expect(updated!.changes!.priorityId).toEqual({
        from: levels.None,
        to: levels.High,
      });
    }
  });

  it("carries no notesText in a notes PATCH's changes", async () => {
    requireProject();
    const trackId = await mkTrack("Activity Notes Track");

    await request("owner", `/tracks/${trackId}`, {
      method: "PATCH",
      body: JSON.stringify({
        notes: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
      }),
    });

    const updated = (await entityFeed("track", trackId)).find(
      (a) => a.action === "updated"
    );
    expect(updated!.changes).toHaveProperty("notes");
    expect(updated!.changes).not.toHaveProperty("notesText");
  });
});

describe("labels", () => {
  it("creates project labels, sets them on an entity, and reads them back", async () => {
    requireProject();

    const created = await request(
      "owner",
      `/projects/${suite.projectId}/labels`,
      {
        method: "POST",
        body: JSON.stringify({ name: "needs vocals", colourHex: "#FF8800" }),
      }
    );
    expect(created.status).toBe(201);
    const label = await created.json();
    expect(label.name).toBe("needs vocals");

    // Re-creating the same name is refused and leaves the one label.
    const again = await request(
      "owner",
      `/projects/${suite.projectId}/labels`,
      {
        method: "POST",
        body: JSON.stringify({ name: "needs vocals" }),
      }
    );
    expect(again.status).toBe(409);
    const all = await (
      await request("owner", `/projects/${suite.projectId}/labels`)
    ).json();
    expect(
      all.filter((l: { name: string }) => l.name === "needs vocals")
    ).toHaveLength(1);

    const trackId = await mkTrack("Labelled Track");

    // A set request mixing an existing id with a new name.
    const set = await request("owner", `/tracks/${trackId}/labels`, {
      method: "PUT",
      body: JSON.stringify({
        labelIds: [label.id],
        names: ["sample clearance"],
      }),
    });
    expect(set.status).toBe(200);
    const names = (await set.json()).map((l: { name: string }) => l.name);
    expect(names).toEqual(["needs vocals", "sample clearance"]);

    // The track detail and the paginated list both surface the labels.
    const detail = await (await request("viewer", `/tracks/${trackId}`)).json();
    expect(detail.labels.map((l: { name: string }) => l.name)).toEqual([
      "needs vocals",
      "sample clearance",
    ]);

    const page = await (
      await request(
        "owner",
        `/projects/${suite.projectId}/tracks/paginated?q=Labelled Track`
      )
    ).json();
    const row = page.rows.find((r: { id: number }) => r.id === trackId);
    expect(row.labels.map((l: { name: string }) => l.name)).toEqual([
      "needs vocals",
      "sample clearance",
    ]);

    // An empty set clears them.
    const cleared = await request("owner", `/tracks/${trackId}/labels`, {
      method: "PUT",
      body: JSON.stringify({ labelIds: [] }),
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual([]);
  });

  it("deleting a label answers 204 and the label is gone", async () => {
    requireProject();
    const created = await request(
      "owner",
      `/projects/${suite.projectId}/labels`,
      { method: "POST", body: JSON.stringify({ name: "one-shot" }) }
    );
    const labelId = (await created.json()).id as number;

    const del = await request(
      "owner",
      `/projects/${suite.projectId}/labels/${labelId}`,
      { method: "DELETE" }
    );
    expect(del.status).toBe(204);
    expect(await del.text()).toBe("");

    const labels = await (
      await request("owner", `/projects/${suite.projectId}/labels`)
    ).json();
    expect(labels.some((l: { id: number }) => l.id === labelId)).toBe(false);
  });

  it("shares one label across a track, a collection, and a session", async () => {
    requireProject();
    const made = await request("owner", `/projects/${suite.projectId}/labels`, {
      method: "POST",
      body: JSON.stringify({ name: "cross-entity" }),
    });
    const labelId = (await made.json()).id as number;

    const trackId = await mkTrack("Cross Track");
    const collectionId = await mkCollection("Cross Collection");
    const session = await mkSession({ name: "Cross Session" });

    for (const path of [
      `/tracks/${trackId}/labels`,
      `/collections/${collectionId}/labels`,
      `/sessions/${session.id}/labels`,
    ]) {
      const res = await request("owner", path, {
        method: "PUT",
        body: JSON.stringify({ labelIds: [labelId] }),
      });
      expect(res.status, path).toBe(200);
    }

    // Deleting the label removes it from every entity it was on.
    const del = await request(
      "owner",
      `/projects/${suite.projectId}/labels/${labelId}`,
      { method: "DELETE" }
    );
    expect(del.status).toBe(204);

    const detail = await (
      await request("viewer", `/collections/${collectionId}`)
    ).json();
    expect(detail.labels).toEqual([]);
  });

  it("rejects a label id from another project", async () => {
    requireProject();
    const otherRes = await request("owner", "/projects", {
      method: "POST",
      body: JSON.stringify({ name: `Label Project ${Date.now()}`, links: [] }),
    });
    const otherProjectId = (await otherRes.json()).id as number;

    try {
      const foreign = await request(
        "owner",
        `/projects/${otherProjectId}/labels`,
        {
          method: "POST",
          body: JSON.stringify({ name: "foreign" }),
        }
      );
      const foreignId = (await foreign.json()).id as number;

      const trackId = await mkTrack("Guard Track");
      const set = await request("owner", `/tracks/${trackId}/labels`, {
        method: "PUT",
        body: JSON.stringify({ labelIds: [foreignId] }),
      });
      // A label id from another project 404s, like every other foreign id —
      // it is not silently dropped.
      expect(set.status).toBe(404);
    } finally {
      await request("owner", `/projects/${otherProjectId}`, {
        method: "DELETE",
      });
    }
  });

  it("gates label endpoints by role", async () => {
    requireProject();
    const trackId = await mkTrack("Label Gate Track");

    await expectAccess("GET", `/projects/${suite.projectId}/labels`, {
      viewer: 200,
    });
    await expectAccess(
      "POST",
      `/projects/${suite.projectId}/labels`,
      { viewer: 403, editor: 201 },
      { name: `gate ${Date.now()}` }
    );
    await expectAccess(
      "PUT",
      `/tracks/${trackId}/labels`,
      { viewer: 403, editor: 200 },
      { labelIds: [] }
    );

    const made = await request("owner", `/projects/${suite.projectId}/labels`, {
      method: "POST",
      body: JSON.stringify({ name: `gate patch ${Date.now()}` }),
    });
    const labelId = (await made.json()).id as number;
    await expectAccess(
      "PATCH",
      `/projects/${suite.projectId}/labels/${labelId}`,
      { viewer: 403, editor: 200 },
      { colourHex: "#112233" }
    );
  });

  describe("updating a label", () => {
    const patchLabel = (labelId: number, body: unknown, projectId?: number) =>
      request(
        "owner",
        `/projects/${projectId ?? suite.projectId}/labels/${labelId}`,
        { method: "PATCH", body: JSON.stringify(body) }
      );
    const mkLabel = async (name: string, projectId?: number) => {
      const res = await request(
        "owner",
        `/projects/${projectId ?? suite.projectId}/labels`,
        { method: "POST", body: JSON.stringify({ name }) }
      );
      return (await res.json()) as { id: number; name: string };
    };

    it("renames a label and keeps its colour", async () => {
      requireProject();
      const label = await mkLabel(`rename me ${Date.now()}`);
      const res = await patchLabel(label.id, { name: "renamed" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(label.id);
      expect(body.name).toBe("renamed");
      expect(body.colourHex).toBe("#94A3B8");
    });

    it("recolours a label and keeps its name", async () => {
      requireProject();
      const label = await mkLabel(`recolour me ${Date.now()}`);
      const res = await patchLabel(label.id, { colourHex: "#AABBCC" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe(label.name);
      expect(body.colourHex).toBe("#AABBCC");
    });

    it("rejects an empty body and a malformed colour", async () => {
      requireProject();
      const label = await mkLabel(`bad body ${Date.now()}`);
      expect((await patchLabel(label.id, {})).status).toBe(400);
      expect((await patchLabel(label.id, { colourHex: "red" })).status).toBe(
        400
      );
    });

    it("answers 404 for another project's label", async () => {
      requireProject();
      const otherRes = await request("owner", "/projects", {
        method: "POST",
        body: JSON.stringify({
          name: `Label Patch Project ${Date.now()}`,
          links: [],
        }),
      });
      const otherProjectId = (await otherRes.json()).id as number;
      try {
        const foreign = await mkLabel("foreign", otherProjectId);
        const res = await patchLabel(foreign.id, { name: "taken over" });
        expect(res.status).toBe(404);
      } finally {
        await request("owner", `/projects/${otherProjectId}`, {
          method: "DELETE",
        });
      }
    });

    it("answers 409 when the name is another label's", async () => {
      requireProject();
      const taken = await mkLabel(`taken ${Date.now()}`);
      const label = await mkLabel(`free ${Date.now()}`);
      const res = await patchLabel(label.id, { name: taken.name });
      expect(res.status).toBe(409);
    });
  });
});

describe("saved views", () => {
  it("creates, lists, overwrites, applies-shape, and deletes a saved view", async () => {
    requireProject();

    const created = await request(
      "owner",
      `/projects/${suite.projectId}/saved-views`,
      {
        method: "POST",
        body: JSON.stringify({
          name: "Mixing queue",
          kind: "track",
          config: { query: "status=3&sort=priority.desc" },
        }),
      }
    );
    expect(created.status).toBe(201);
    const view = await created.json();
    expect(view.name).toBe("Mixing queue");
    expect(view.config.query).toBe("status=3&sort=priority.desc");
    expect(view.ownerId).toBe(owner.userId);
    expect(view.shared).toBe(false);

    // Listing is scoped to the kind.
    const list = await (
      await request(
        "owner",
        `/projects/${suite.projectId}/saved-views?kind=track`
      )
    ).json();
    expect(list.find((v: { id: number }) => v.id === view.id)).toBeTruthy();
    const otherKind = await (
      await request(
        "owner",
        `/projects/${suite.projectId}/saved-views?kind=collection`
      )
    ).json();
    expect(
      otherKind.find((v: { id: number }) => v.id === view.id)
    ).toBeUndefined();

    // Re-creating the same name+kind overwrites the config, not a duplicate.
    const overwrite = await request(
      "owner",
      `/projects/${suite.projectId}/saved-views`,
      {
        method: "POST",
        body: JSON.stringify({
          name: "Mixing queue",
          kind: "track",
          config: { query: "daw=ableton" },
        }),
      }
    );
    expect(overwrite.status).toBe(201);
    expect((await overwrite.json()).id).toBe(view.id);

    const patched = await request(
      "owner",
      `/projects/${suite.projectId}/saved-views/${view.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed queue" }),
      }
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).name).toBe("Renamed queue");

    const deleted = await request(
      "owner",
      `/projects/${suite.projectId}/saved-views/${view.id}`,
      { method: "DELETE" }
    );
    expect(deleted.status).toBe(204);
    const afterDelete = await (
      await request(
        "owner",
        `/projects/${suite.projectId}/saved-views?kind=track`
      )
    ).json();
    expect(
      afterDelete.find((v: { id: number }) => v.id === view.id)
    ).toBeUndefined();
  });

  it("gates saved-view endpoints by role", async () => {
    requireProject();
    await expectAccess("GET", `/projects/${suite.projectId}/saved-views`, {
      viewer: 200,
    });
    await expectAccess(
      "POST",
      `/projects/${suite.projectId}/saved-views`,
      { viewer: 403, editor: 201 },
      { name: `gate ${Date.now()}`, kind: "session", config: { query: "" } }
    );
  });

  it("rejects a plural kind", async () => {
    requireProject();
    const list = await request(
      "viewer",
      `/projects/${suite.projectId}/saved-views?kind=tracks`
    );
    expect(list.status).toBe(400);
    const create = await request(
      "owner",
      `/projects/${suite.projectId}/saved-views`,
      {
        method: "POST",
        body: JSON.stringify({
          name: "Plural",
          kind: "tracks",
          config: { query: "" },
        }),
      }
    );
    expect(create.status).toBe(400);
  });
});

describe("saved view ownership", () => {
  type ListedView = {
    id: number;
    name: string;
    ownerId: string;
    shared: boolean;
    owner: { id: string; name: string };
  };

  const viewsPath = () => `/projects/${suite.projectId}/saved-views`;
  const viewPath = (id: number) => `${viewsPath()}/${id}`;

  /** Saves a private track view as `as` and returns the row. */
  async function saveView(
    as: (path: string, init: RequestInit) => Response | Promise<Response>,
    name: string,
    query = ""
  ): Promise<ListedView> {
    const res = await as(viewsPath(), {
      method: "POST",
      body: JSON.stringify({ name, kind: "track", config: { query } }),
    });
    expect(res.status).toBe(201);
    return res.json();
  }
  const asOwner = (path: string, init: RequestInit) =>
    request("owner", path, init);
  const asEditor = (path: string, init: RequestInit) =>
    request("editor", path, init);

  async function listAs(
    send: (path: string) => Promise<Response>
  ): Promise<ListedView[]> {
    const res = await send(viewsPath());
    expect(res.status).toBe(200);
    return res.json();
  }

  async function storedView(id: number) {
    const [row] = await db
      .select()
      .from(savedViews)
      .where(eq(savedViews.id, id));
    return row;
  }

  /** An admin of the suite project, signed up for the one test that needs it. */
  async function seedAdmin(label: string) {
    const admin = await signUpAndSignIn(`Saved View ${label} Admin`);
    await seedMember(admin, "admin");
    return admin;
  }

  it("lists the caller's own views and every shared one, each with its owner", async () => {
    requireProject();
    const stamp = Date.now();
    const editorPrivate = await saveView(asEditor, `Editor private ${stamp}`);
    const editorShared = await saveView(asEditor, `Editor shared ${stamp}`);
    const shared = await request("editor", viewPath(editorShared.id), {
      method: "PATCH",
      body: JSON.stringify({ shared: true }),
    });
    expect(shared.status).toBe(200);
    expect((await shared.json()).shared).toBe(true);
    const ownerPrivate = await saveView(asOwner, `Owner private ${stamp}`);
    // A viewer cannot save a view, but keeps one saved while an editor.
    const [viewerOwn] = await db
      .insert(savedViews)
      .values({
        projectId: suite.projectId,
        ownerId: viewer.userId,
        name: `Viewer own ${stamp}`,
        kind: "track",
        config: { query: "" },
      })
      .returning();

    const asViewer = await listAs((path) => request("viewer", path));
    const viewerIds = asViewer.map((v) => v.id);
    expect(viewerIds).toContain(viewerOwn!.id);
    expect(viewerIds).toContain(editorShared.id);
    expect(viewerIds).not.toContain(editorPrivate.id);
    expect(viewerIds).not.toContain(ownerPrivate.id);
    expect(asViewer.find((v) => v.id === editorShared.id)?.owner).toEqual({
      id: editor.userId,
      name: editor.name,
    });

    // Outranking the owner lets an admin change a view, not see a private one.
    const ownerIds = (await listAs((path) => request("owner", path))).map(
      (v) => v.id
    );
    expect(ownerIds).toContain(ownerPrivate.id);
    expect(ownerIds).toContain(editorShared.id);
    expect(ownerIds).not.toContain(editorPrivate.id);
  });

  it("lets only a view's owner share or unshare it", async () => {
    requireProject();
    const stamp = Date.now();
    const ownView = await saveView(asEditor, `Editor sharing ${stamp}`);
    const ownerView = await saveView(asOwner, `Owner sharing ${stamp}`);
    const ownerShared = await request("owner", viewPath(ownerView.id), {
      method: "PATCH",
      body: JSON.stringify({ shared: true }),
    });
    expect(ownerShared.status).toBe(200);

    const unshared = await request("editor", viewPath(ownView.id), {
      method: "PATCH",
      body: JSON.stringify({ shared: false }),
    });
    expect(unshared.status).toBe(200);
    expect((await unshared.json()).shared).toBe(false);

    // An editor who can see another member's shared view still cannot touch
    // it, and learns no more than a missing view would tell them.
    for (const body of [{ shared: false }, { name: "Taken over" }]) {
      const res = await request("editor", viewPath(ownerView.id), {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(404);
    }
    expect(await storedView(ownerView.id)).toMatchObject({
      name: `Owner sharing ${stamp}`,
      shared: true,
    });
  });

  it("lets an admin edit another member's view but not share it", async () => {
    requireProject();
    const admin = await seedAdmin("Sharing");
    const editorView = await saveView(asEditor, `Editor admin ${Date.now()}`);

    const shareRes = await requestAs(admin, viewPath(editorView.id), {
      method: "PATCH",
      body: JSON.stringify({ name: "Admin shared it", shared: true }),
    });
    expect(shareRes.status).toBe(403);
    expect(await storedView(editorView.id)).toMatchObject({
      name: editorView.name,
      shared: false,
    });

    const renamed = await requestAs(admin, viewPath(editorView.id), {
      method: "PATCH",
      body: JSON.stringify({ name: "Admin renamed it" }),
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({
      name: "Admin renamed it",
      ownerId: editor.userId,
    });

    // With no view behind the id there is nothing to refuse sharing on.
    const missing = await requestAs(admin, viewPath(2_000_000_000), {
      method: "PATCH",
      body: JSON.stringify({ shared: true }),
    });
    expect(missing.status).toBe(404);
  });

  it("lets a view's owner or an admin delete it, and nobody else", async () => {
    requireProject();
    const admin = await seedAdmin("Delete");
    const stamp = Date.now();
    const ownerView = await saveView(asOwner, `Owner delete ${stamp}`);
    const editorView = await saveView(asEditor, `Editor delete ${stamp}`);
    const ownEditorView = await saveView(asEditor, `Editor own ${stamp}`);

    const refused = await request("editor", viewPath(ownerView.id), {
      method: "DELETE",
    });
    expect(refused.status).toBe(404);
    expect(await storedView(ownerView.id)).toBeDefined();

    const byAdmin = await requestAs(admin, viewPath(editorView.id), {
      method: "DELETE",
    });
    expect(byAdmin.status).toBe(204);
    expect(await storedView(editorView.id)).toBeUndefined();

    const byOwner = await request("editor", viewPath(ownEditorView.id), {
      method: "DELETE",
    });
    expect(byOwner.status).toBe(204);
    expect(await storedView(ownEditorView.id)).toBeUndefined();
  });

  it("keeps same-named views from different members apart", async () => {
    requireProject();
    const name = `Same name ${Date.now()}`;
    const editorView = await saveView(asEditor, name, "sort=title.asc");
    const ownerView = await saveView(asOwner, name, "sort=title.desc");
    expect(ownerView.id).not.toBe(editorView.id);

    const overwritten = await saveView(asEditor, name, "daw=ableton");
    expect(overwritten.id).toBe(editorView.id);
    expect((await storedView(editorView.id))?.config.query).toBe("daw=ableton");
    expect((await storedView(ownerView.id))?.config.query).toBe(
      "sort=title.desc"
    );
  });

  it("keeps a departed member's views, and their shared ones stay listed", async () => {
    requireProject();
    const leaver = await signUpAndSignIn("Saved View Leaver");
    await seedMember(leaver, "editor");
    const asLeaver = (path: string, init: RequestInit) =>
      requestAs(leaver, path, init);
    const view = await saveView(asLeaver, `Leaver shared ${Date.now()}`);
    const shared = await requestAs(leaver, viewPath(view.id), {
      method: "PATCH",
      body: JSON.stringify({ shared: true }),
    });
    expect(shared.status).toBe(200);

    const left = await requestAs(leaver, `/projects/${suite.projectId}/leave`, {
      method: "POST",
    });
    expect(left.status).toBe(200);

    const listed = await listAs((path) => request("viewer", path));
    expect(listed.find((v) => v.id === view.id)?.owner).toEqual({
      id: leaver.userId,
      name: leaver.name,
    });
  });
});

describe("plugin inventory", () => {
  const structure = (
    tracks: { name: string; devices: string[] }[],
    plugins?: Record<string, { host: string; manufacturer?: string }>
  ): Record<string, unknown> => ({
    tracks: tracks.map((t) => ({ kind: "audio", ...t })),
    clips: { audio: 0, midi: 0 },
    ...(plugins ? { plugins } : {}),
  });

  it("counts each device by the sessions and tracks that carry it", async () => {
    requireProject();

    const a = await mkSession({
      name: `plugins A ${Date.now()}`,
      structure: structure([
        { name: "Vox", devices: ["Serum 2", "Reverb"] },
        { name: "Bass", devices: ["Serum 2"] },
      ]),
    });
    const b = await mkSession({
      name: `plugins B ${Date.now()}`,
      structure: structure([
        { name: "Keys", devices: ["Serum 2", "EQ Eight"] },
      ]),
    });

    const res = await request("owner", `/projects/${suite.projectId}/plugins`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as {
      name: string;
      sessions: number;
      tracks: number;
      sessionIds: number[];
      sessionTracks: number[];
      origin: string;
    }[];

    const byName = new Map(rows.map((r) => [r.name, r]));
    // A session that carries a device on two tracks is listed once, in id
    // order, with its own track count beside it.
    const serum = [
      { id: a.id, tracks: 2 },
      { id: b.id, tracks: 1 },
    ].sort((x, y) => x.id - y.id);
    expect(byName.get("Serum 2")).toEqual({
      name: "Serum 2",
      sessions: 2,
      tracks: 3,
      sessionIds: serum.map((s) => s.id),
      sessionTracks: serum.map((s) => s.tracks),
      origin: "builtin",
    });
    expect(byName.get("Reverb")).toEqual({
      name: "Reverb",
      sessions: 1,
      tracks: 1,
      sessionIds: [a.id],
      sessionTracks: [1],
      origin: "builtin",
    });
    expect(byName.get("EQ Eight")).toEqual({
      name: "EQ Eight",
      sessions: 1,
      tracks: 1,
      sessionIds: [b.id],
      sessionTracks: [1],
      origin: "builtin",
    });

    // Most widely used first.
    expect(rows[0]?.name).toBe("Serum 2");
  });

  it("ignores sessions with no parsed structure", async () => {
    requireProject();
    await mkSession({ name: `plugins none ${Date.now()}` });

    const rows = (await (
      await request("owner", `/projects/${suite.projectId}/plugins`)
    ).json()) as { name: string }[];

    expect(rows.every((r) => typeof r.name === "string")).toBe(true);
  });

  it("is readable by a viewer", async () => {
    requireProject();
    await expectAccess("GET", `/projects/${suite.projectId}/plugins`, {
      viewer: 200,
    });
  });

  it("marks a device in the plugins map as a third-party plugin with its host and manufacturer", async () => {
    requireProject();

    const session = await mkSession({
      name: `plugins origin ${Date.now()}`,
      structure: structure([{ name: "Lead", devices: ["Serum 2 Origin"] }], {
        "Serum 2 Origin": { host: "vst3", manufacturer: "Xfer Records" },
      }),
    });

    const rows = (await (
      await request("owner", `/projects/${suite.projectId}/plugins`)
    ).json()) as {
      name: string;
      sessions: number;
      tracks: number;
      sessionIds: number[];
      sessionTracks: number[];
      origin: string;
      host?: string;
      manufacturer?: string;
    }[];

    expect(rows.find((r) => r.name === "Serum 2 Origin")).toEqual({
      name: "Serum 2 Origin",
      sessions: 1,
      tracks: 1,
      sessionIds: [session.id],
      sessionTracks: [1],
      origin: "plugin",
      host: "vst3",
      manufacturer: "Xfer Records",
    });
  });

  it("marks a device absent from the plugins map as one of the DAW's own", async () => {
    requireProject();

    await mkSession({
      name: `plugins live ${Date.now()}`,
      structure: structure([
        { name: "Bus", devices: ["Glue Compressor Origin"] },
      ]),
    });

    const rows = (await (
      await request("owner", `/projects/${suite.projectId}/plugins`)
    ).json()) as { name: string; origin: string; host?: string }[];

    const row = rows.find((r) => r.name === "Glue Compressor Origin");
    expect(row?.origin).toBe("builtin");
    expect(row?.host).toBeUndefined();
  });

  it("merges the counts of a name that appears as a plugin in one session and a DAW's own device in another", async () => {
    requireProject();

    const name = `Ambiguous Device ${Date.now()}`;
    const asPlugin = await mkSession({
      name: `plugins ambiguous plugin ${Date.now()}`,
      structure: structure([{ name: "A", devices: [name] }], {
        [name]: { host: "au" },
      }),
    });
    const asBuiltin = await mkSession({
      name: `plugins ambiguous live ${Date.now()}`,
      structure: structure([{ name: "B", devices: [name] }]),
    });

    const rows = (await (
      await request("owner", `/projects/${suite.projectId}/plugins`)
    ).json()) as {
      name: string;
      sessions: number;
      tracks: number;
      origin: string;
      host?: string;
    }[];

    const row = rows.find((r) => r.name === name);
    expect(row).toMatchObject({
      name,
      sessions: 2,
      tracks: 2,
      sessionIds: [asPlugin.id, asBuiltin.id].sort((x, y) => x - y),
    });
    // `max()` picks the one session that named a host over the one that didn't.
    expect(row?.origin).toBe("plugin");
    expect(row?.host).toBe("au");
  });

  it("counts a device's track entries per session, in session id order", async () => {
    requireProject();

    const name = `Per Session Device ${Date.now()}`;
    const many = await mkSession({
      name: `plugins many ${Date.now()}`,
      structure: structure([
        { name: "One", devices: [name] },
        { name: "Two", devices: [name, "Utility"] },
        // Two instances on one chain are two entries.
        { name: "Three", devices: [name, name] },
      ]),
    });
    const once = await mkSession({
      name: `plugins once ${Date.now()}`,
      structure: structure([{ name: "Only", devices: [name] }]),
    });

    const rows = (await (
      await request("owner", `/projects/${suite.projectId}/plugins`)
    ).json()) as {
      name: string;
      tracks: number;
      sessionIds: number[];
      sessionTracks: number[];
    }[];

    const row = rows.find((r) => r.name === name);
    const expected = [
      { id: many.id, tracks: 4 },
      { id: once.id, tracks: 1 },
    ].sort((x, y) => x.id - y.id);
    expect(row).toMatchObject({
      tracks: 5,
      sessionIds: expected.map((s) => s.id),
      sessionTracks: expected.map((s) => s.tracks),
    });
  });
});

describe("sessions by device", () => {
  const structure = (
    tracks: { name: string; devices: string[] }[]
  ): Record<string, unknown> => ({
    tracks: tracks.map((t) => ({ kind: "audio", ...t })),
    clips: { audio: 0, midi: 0 },
  });

  it("lists sessions carrying a device with the tracks that carry it, in set order", async () => {
    requireProject();

    const device = `Serum 2 Sessions ${Date.now()}`;
    const withDevice = await mkSession({
      name: `has device ${Date.now()}`,
      structure: structure([
        { name: "Zeta", devices: [device] },
        { name: "Alpha", devices: [device] },
        { name: "Other", devices: ["Reverb"] },
      ]),
    });
    await mkSession({
      name: `no device ${Date.now()}`,
      structure: structure([{ name: "Solo", devices: ["Reverb"] }]),
    });

    const res = await request(
      "owner",
      `/projects/${suite.projectId}/plugins/sessions?device=${encodeURIComponent(device)}`
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as {
      id: number;
      onTracks: string[];
    }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(withDevice.id);
    expect(rows[0]?.onTracks).toEqual(["Zeta", "Alpha"]);
  });

  it("answers an empty list for a device no session carries", async () => {
    requireProject();

    const res = await request(
      "owner",
      `/projects/${suite.projectId}/plugins/sessions?device=${encodeURIComponent(`Nonexistent ${Date.now()}`)}`
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("requires a device query parameter", async () => {
    requireProject();

    const res = await request(
      "owner",
      `/projects/${suite.projectId}/plugins/sessions`
    );
    expect(res.status).toBe(400);
  });

  it("only lists sessions from the caller's project", async () => {
    requireProject();

    const device = `Cross Project Device ${Date.now()}`;
    await mkSession({
      name: `outside project ${Date.now()}`,
      structure: structure([{ name: "Alien", devices: [device] }]),
    });

    const other = await throwawayProject();
    const otherRes = await requestAs(
      other.owner,
      `/projects/${other.id}/plugins/sessions?device=${encodeURIComponent(device)}`
    );
    expect(otherRes.status).toBe(200);
    expect(await otherRes.json()).toEqual([]);
  });

  it("is readable by a viewer", async () => {
    requireProject();
    await expectAccess(
      "GET",
      `/projects/${suite.projectId}/plugins/sessions?device=x`,
      { viewer: 200 }
    );
  });
});

describe("project samples", () => {
  type Usage = {
    path: string;
    kind: string;
    sessions: number;
    sessionIds: number[];
    missing: boolean;
  };

  /** A directory no other test in the shared project reaches. */
  const uniquePath = (name: string) =>
    `/samples/${Date.now()}-${Math.random().toString(36).slice(2)}/${name}`;

  const sample = (
    path: string,
    kind: SessionSample["kind"] = "project",
    status: SessionSample["status"] = "present"
  ): SessionSample => ({ path, kind, status });

  const saveAt = (sessionId: number, updatedAt: Date) =>
    db.update(sessions).set({ updatedAt }).where(eq(sessions.id, sessionId));

  const usageOf = async (
    prefix: string,
    actor: Actor = owner,
    id: number = suite.projectId
  ) => {
    const res = await requestAs(actor, `/projects/${id}/samples`);
    expect(res.status).toBe(200);
    return ((await res.json()) as Usage[]).filter((row) =>
      row.path.startsWith(prefix)
    );
  };

  const sessionsOf = async (
    path: string,
    actor: Actor = owner,
    id: number = suite.projectId
  ) => {
    const res = await requestAs(
      actor,
      `/projects/${id}/samples/sessions?path=${encodeURIComponent(path)}`
    );
    expect(res.status).toBe(200);
    return (await res.json()) as {
      id: number;
      name: string;
      daw: string;
      updatedAt: string;
      trackId: number | null;
      trackTitle: string | null;
      status: string;
    }[];
  };

  it("groups sessions by path, most widely shared first and then by path", async () => {
    requireProject();

    const dir = uniquePath("group");
    const kick = `${dir}/kick.wav`;
    const snare = `${dir}/snare.wav`;
    const hat = `${dir}/hat.wav`;
    const one = await mkSession({
      name: "ps-one",
      samples: [sample(kick), sample(snare)],
    });
    const two = await mkSession({
      name: "ps-two",
      samples: [sample(kick), sample(hat)],
    });
    await mkSession({ name: "ps-none" });

    const rows = await usageOf(dir);

    expect(rows.map((row) => [row.path, row.sessions])).toEqual([
      [kick, 2],
      [hat, 1],
      [snare, 1],
    ]);
    expect(rows[0]?.sessionIds.slice().sort()).toEqual([one.id, two.id].sort());
    expect(rows[1]?.sessionIds).toEqual([two.id]);
    expect(rows[2]?.sessionIds).toEqual([one.id]);
  });

  it("marks a path missing when any session reports it missing", async () => {
    requireProject();

    const dir = uniquePath("missing");
    const shared = `${dir}/shared.wav`;
    const solo = `${dir}/solo.wav`;
    await mkSession({
      name: "ps-present",
      samples: [sample(shared, "project", "present"), sample(solo)],
    });
    await mkSession({
      name: "ps-missing",
      samples: [sample(shared, "project", "missing")],
    });

    const rows = await usageOf(dir);

    expect(rows.find((row) => row.path === shared)?.missing).toBe(true);
    expect(rows.find((row) => row.path === solo)?.missing).toBe(false);
  });

  it("reports the kind the most recently saved session records for a path", async () => {
    requireProject();

    const dir = uniquePath("kind");
    const path = `${dir}/mixed.wav`;
    const older = await mkSession({
      name: "ps-older",
      samples: [sample(path, "project")],
    });
    const newer = await mkSession({
      name: "ps-newer",
      samples: [sample(path, "outside")],
    });
    await saveAt(older.id, new Date(Date.now() - 120_000));
    await saveAt(newer.id, new Date(Date.now() - 60_000));

    const [row] = await usageOf(dir);
    expect(row?.kind).toBe("outside");

    await saveAt(older.id, new Date(Date.now() + 60_000));
    const [flipped] = await usageOf(dir);
    expect(flipped?.kind).toBe("project");
  });

  it("lists the sessions carrying a path, most recently saved first, with their status and track", async () => {
    requireProject();

    const path = uniquePath("sessions") + "/lead.wav";
    const trackId = await mkTrack("ps-track");
    const stale = await mkSession({
      name: "ps-stale",
      samples: [sample(path, "project", "missing")],
    });
    const fresh = await mkSession({
      name: "ps-fresh",
      trackId,
      samples: [sample(path, "project", "present")],
    });
    await mkSession({ name: "ps-other", samples: [sample(`${path}.other`)] });
    await saveAt(stale.id, new Date(Date.now() - 60_000));
    await saveAt(fresh.id, new Date(Date.now() + 60_000));

    const rows = await sessionsOf(path);

    expect(rows.map((row) => row.id)).toEqual([fresh.id, stale.id]);
    expect(rows[0]).toMatchObject({
      name: "ps-fresh",
      daw: "ableton",
      trackId,
      trackTitle: "ps-track",
      status: "present",
    });
    expect(rows[1]).toMatchObject({
      trackId: null,
      trackTitle: null,
      status: "missing",
    });
    expect(new Date(rows[0]?.updatedAt ?? "").getTime()).toBeGreaterThan(
      new Date(rows[1]?.updatedAt ?? "").getTime()
    );
  });

  it("matches a path with reserved URL characters exactly", async () => {
    requireProject();

    const path = `${uniquePath("odd")}/Kick #1 & Snare? 100%.wav`;
    const session = await mkSession({
      name: "ps-odd",
      samples: [sample(path)],
    });

    expect((await sessionsOf(path)).map((row) => row.id)).toEqual([session.id]);
  });

  it("answers an empty list for a path no session carries", async () => {
    requireProject();

    expect(await sessionsOf(uniquePath("absent"))).toEqual([]);
  });

  it("requires a path query parameter", async () => {
    requireProject();

    const missing = await request(
      "owner",
      `/projects/${suite.projectId}/samples/sessions`
    );
    expect(missing.status).toBe(400);
    const empty = await request(
      "owner",
      `/projects/${suite.projectId}/samples/sessions?path=`
    );
    expect(empty.status).toBe(400);
  });

  it("only reads the caller's project", async () => {
    requireProject();

    const dir = uniquePath("isolated");
    const path = `${dir}/shared.wav`;
    await mkSession({ name: "ps-here", samples: [sample(path)] });

    const other = await throwawayProject();
    const created = await requestAs(other.owner, "/sessions", {
      method: "POST",
      body: JSON.stringify({
        name: "ps-there",
        daw: "ableton",
        projectId: other.id,
        samples: [sample(path)],
      }),
    });
    expect(created.status).toBe(201);
    const there = (await created.json()) as { id: number };

    const inOther = await usageOf(dir, other.owner, other.id);
    expect(inOther).toHaveLength(1);
    expect(inOther[0]?.sessionIds).toEqual([there.id]);
    expect(
      (await sessionsOf(path, other.owner, other.id)).map((row) => row.id)
    ).toEqual([there.id]);
    const here = await usageOf(dir);
    expect(here).toHaveLength(1);
    expect(here[0]?.sessions).toBe(1);
  });

  it("is readable by a viewer", async () => {
    requireProject();
    await expectAccess("GET", `/projects/${suite.projectId}/samples`, {
      viewer: 200,
    });
    await expectAccess(
      "GET",
      `/projects/${suite.projectId}/samples/sessions?path=x`,
      { viewer: 200 }
    );
  });
});

describe("project saves feed", () => {
  /** A save's `meta`, filled in exactly as `saveFromSession` fills it: every field present. */
  const fullMeta = (tempo: string) => ({
    tempo,
    timeSignature: null,
    rootNote: null,
    scale: null,
    tracksCount: null,
    scenesCount: null,
    dawVersion: null,
    samplePaths: null,
    structure: null,
  });

  /** Records one save against a session, by the path the session was made with. */
  async function observe(localFilepath: string, at: number, tempo?: string) {
    const [session] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.projectId, suite.projectId),
          eq(sessions.localFilepath, localFilepath)
        )
      );
    const stored = await recordRevisions([
      {
        sessionId: session!.id,
        projectId: suite.projectId,
        fileUpdatedAt: new Date(at),
        source: "scan",
        ...(tempo == null ? {} : { meta: fullMeta(tempo) }),
      },
    ]);
    expect(stored).toBe(1);
  }

  it("answers newest first, with previousMeta populated from the second save on", async () => {
    requireProject();

    const localFilepath = `/mix/feed-${Date.now()}.als`;
    const session = await mkSession({
      name: `Feed Session ${Date.now()}`,
      localFilepath,
    });

    const first = Date.UTC(2026, 4, 1, 10, 0, 0);
    const second = Date.UTC(2026, 4, 2, 10, 0, 0);
    await observe(localFilepath, first, "120");
    await observe(localFilepath, second, "125");

    const res = await request("viewer", `/projects/${suite.projectId}/saves`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as {
      sessionId: number;
      fileUpdatedAt: string;
      previousMeta: unknown | null;
    }[];

    const ours = rows
      .filter((r) => r.sessionId === session.id)
      .sort((a, b) => b.fileUpdatedAt.localeCompare(a.fileUpdatedAt));
    expect(ours).toHaveLength(2);
    expect(new Date(ours[0]!.fileUpdatedAt).getTime()).toBe(second);
    expect(new Date(ours[1]!.fileUpdatedAt).getTime()).toBe(first);
    expect(ours[0]!.previousMeta).not.toBeNull();
    expect(ours[1]!.previousMeta).toBeNull();
  });

  it("carries the owning session and its track", async () => {
    requireProject();

    const trackId = await mkTrack(`Feed Track ${Date.now()}`);
    const localFilepath = `/mix/feed-track-${Date.now()}.als`;
    const session = await mkSession({
      name: `Feed Track Session ${Date.now()}`,
      localFilepath,
      trackId,
    });

    await observe(localFilepath, Date.UTC(2026, 4, 3, 10, 0, 0));

    const rows = (await (
      await request("viewer", `/projects/${suite.projectId}/saves`)
    ).json()) as {
      sessionId: number;
      session: { id: number; trackId: number | null };
    }[];

    const row = rows.find((r) => r.sessionId === session.id);
    expect(row?.session).toMatchObject({ id: session.id, trackId });
  });

  it("buckets a 23:30 UTC save into the next day under Australia/Sydney", async () => {
    requireProject();

    const localFilepath = `/mix/feed-day-${Date.now()}.als`;
    const session = await mkSession({
      name: `Feed Day Session ${Date.now()}`,
      localFilepath,
    });
    const saveAt = Date.UTC(2026, 5, 10, 23, 30, 0);
    await observe(localFilepath, saveAt);

    const utcSame = await request(
      "viewer",
      `/projects/${suite.projectId}/saves?day=2026-06-10&tz=UTC`
    );
    expect(utcSame.status).toBe(200);
    expect(
      ((await utcSame.json()) as { sessionId: number }[]).some(
        (r) => r.sessionId === session.id
      )
    ).toBe(true);

    const sydneySameDay = await request(
      "viewer",
      `/projects/${suite.projectId}/saves?day=2026-06-10&tz=Australia/Sydney`
    );
    expect(sydneySameDay.status).toBe(200);
    expect(
      ((await sydneySameDay.json()) as { sessionId: number }[]).some(
        (r) => r.sessionId === session.id
      )
    ).toBe(false);

    const sydneyNextDay = await request(
      "viewer",
      `/projects/${suite.projectId}/saves?day=2026-06-11&tz=Australia/Sydney`
    );
    expect(sydneyNextDay.status).toBe(200);
    expect(
      ((await sydneyNextDay.json()) as { sessionId: number }[]).some(
        (r) => r.sessionId === session.id
      )
    ).toBe(true);
  });

  it("does not duplicate a row for a track in two collections when filtered by one of them", async () => {
    requireProject();

    const trackId = await mkTrack(`Feed Collections Track ${Date.now()}`);
    const collectionA = await mkCollection(`Feed Collection A ${Date.now()}`);
    const collectionB = await mkCollection(`Feed Collection B ${Date.now()}`);
    await db.insert(collectionTracks).values([
      { collectionId: collectionA, trackId },
      { collectionId: collectionB, trackId },
    ]);

    const localFilepath = `/mix/feed-collections-${Date.now()}.als`;
    const session = await mkSession({
      name: `Feed Collections Session ${Date.now()}`,
      localFilepath,
      trackId,
    });
    await observe(localFilepath, Date.UTC(2026, 5, 12, 10, 0, 0));

    const res = await request(
      "viewer",
      `/projects/${suite.projectId}/saves?collectionId=${collectionA}`
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { sessionId: number }[];
    expect(rows.filter((r) => r.sessionId === session.id)).toHaveLength(1);
  });

  it("rejects a limit above 100 and accepts exactly 100", async () => {
    requireProject();

    const tooMany = await request(
      "viewer",
      `/projects/${suite.projectId}/saves?limit=101`
    );
    expect(tooMany.status).toBe(400);

    const atCap = await request(
      "viewer",
      `/projects/${suite.projectId}/saves?limit=100`
    );
    expect(atCap.status).toBe(200);
  });

  it("is readable by a viewer and refuses an outsider", async () => {
    requireProject();
    await expectAccess("GET", `/projects/${suite.projectId}/saves`, {
      viewer: 200,
    });
  });
});

describe("project today", () => {
  const today = setupSuite("Project today");
  const HOUR_MS = 60 * 60 * 1000;
  const ago = (ms: number) => new Date(Date.now() - ms);

  type Today = {
    renders: { trackId: number }[];
    saves: { sessionId: number }[];
    counts: { renders: number; saves: number };
    quiet: { tracks: { id: number }[]; total: number };
    unassignedSets: {
      sessions: { id: number; name: string; saveCount: number }[];
      total: number;
    };
  };

  async function readToday(caller: "viewer" | "owner" = "viewer") {
    const res = await today.request(
      caller,
      `/projects/${today.projectId}/today`
    );
    expect(res.status).toBe(200);
    return (await res.json()) as Today;
  }

  /** A track with a render linked `linkedAgo` ms ago, backdated on the row. */
  async function trackWithRender(title: string, linkedAgo: number) {
    const trackId = await today.mkTrack(title);
    await today.mkPrimaryAudioWithLoudness(trackId, -14);
    await db
      .update(trackAudios)
      .set({ createdAt: ago(linkedAgo) })
      .where(eq(trackAudios.trackId, trackId));
    return trackId;
  }

  /** A session on `trackId` with one save made `savedAgo` ms ago. */
  async function sessionWithSave(trackId: number, savedAgo: number) {
    const session = await today.mkSession({ trackId });
    await db
      .update(sessions)
      .set({ trackId })
      .where(eq(sessions.id, session.id));
    await db.insert(saves).values({
      sessionId: session.id,
      projectId: today.projectId,
      fileUpdatedAt: ago(savedAgo),
      source: "scan",
    });
    return session.id;
  }

  /** Every test reads the project's slices whole, so it starts empty. */
  beforeEach(async () => {
    await db.delete(sessions).where(eq(sessions.projectId, today.projectId));
    await db.delete(tracks).where(eq(tracks.projectId, today.projectId));
  });

  it("is readable by every member and refuses an outsider", async () => {
    today.requireProject();
    await today.expectAccess("GET", `/projects/${today.projectId}/today`, {
      viewer: 200,
    });
  });

  it("answers the same body to a viewer as to an owner", async () => {
    today.requireProject();
    const trackId = await trackWithRender("Same body", HOUR_MS);
    expect(await readToday("viewer")).toEqual(await readToday("owner"));
    expect((await readToday()).renders.map((r) => r.trackId)).toEqual([
      trackId,
    ]);
  });

  it("answers empty slices for an empty project", async () => {
    today.requireProject();
    expect(await readToday()).toEqual({
      renders: [],
      saves: [],
      counts: { renders: 0, saves: 0 },
      quiet: { tracks: [], total: 0 },
      unassignedSets: { sessions: [], total: 0 },
    });
  });

  it("lists unassigned undismissed DAW sets newest-saved first, capped at 5 with total", async () => {
    today.requireProject();
    const trackId = await today.mkTrack("Assigned Track");
    await today.mkSession({ trackId, name: "Assigned Set" });
    const dismissed = await today.mkSession({ name: "Dismissed Set" });
    await db
      .update(sessions)
      .set({ inboxDismissedAt: new Date() })
      .where(eq(sessions.id, dismissed.id));

    const createdIds: number[] = [];
    for (let i = 0; i < 6; i++) {
      const s = await today.mkSession({ name: `Inbox ${i}` });
      createdIds.push(s.id);
      await db.insert(saves).values({
        sessionId: s.id,
        projectId: today.projectId,
        fileUpdatedAt: ago((6 - i) * HOUR_MS),
        source: "scan",
      });
    }

    const body = await readToday("owner");
    expect(body.unassignedSets.total).toBe(6);
    expect(body.unassignedSets.sessions).toHaveLength(5);
    expect(body.unassignedSets.sessions.map((s) => s.id)).toEqual(
      createdIds.slice(1).reverse()
    );
    expect(body.unassignedSets.sessions[0]?.saveCount).toBe(1);
  });

  it("lists a render linked now and leaves out one linked 25 hours ago", async () => {
    today.requireProject();
    const fresh = await trackWithRender("Fresh render", 0);
    await trackWithRender("Stale render", 25 * HOUR_MS);
    expect((await readToday()).renders.map((r) => r.trackId)).toEqual([fresh]);
  });

  it("lists a save made now and leaves out one made 25 hours ago", async () => {
    today.requireProject();
    const freshTrack = await today.mkTrack("Fresh save");
    const staleTrack = await today.mkTrack("Stale save");
    const fresh = await sessionWithSave(freshTrack, 0);
    await sessionWithSave(staleTrack, 25 * HOUR_MS);
    expect((await readToday()).saves.map((s) => s.sessionId)).toEqual([fresh]);
  });

  it("leaves out an archived track's render and saves", async () => {
    today.requireProject();
    const trackId = await trackWithRender("Archived after linking", HOUR_MS);
    await sessionWithSave(trackId, HOUR_MS);
    await db
      .update(tracks)
      .set({ archivedAt: new Date() })
      .where(eq(tracks.id, trackId));
    const body = await readToday();
    expect(body.renders).toEqual([]);
    expect(body.saves).toEqual([]);
  });

  it("lists a track untouched for 31 days as quiet and not a fresh one", async () => {
    today.requireProject();
    const old = await today.mkTrack("Gone quiet");
    await today.mkTrack("Just made");
    await db
      .update(tracks)
      .set({ updatedAt: ago(31 * 24 * HOUR_MS) })
      .where(eq(tracks.id, old));
    const { quiet } = await readToday();
    expect(quiet.tracks.map((t) => t.id)).toEqual([old]);
    expect(quiet.total).toBe(1);
  });

  it("caps renders and saves at their limits", async () => {
    today.requireProject();
    for (let i = 0; i < TODAY_RENDER_LIMIT + 2; i++) {
      const trackId = await trackWithRender(`Capped ${i}`, HOUR_MS);
      await sessionWithSave(trackId, HOUR_MS);
    }
    const body = await readToday();
    expect(body.renders).toHaveLength(TODAY_RENDER_LIMIT);
    expect(body.saves).toHaveLength(TODAY_SAVE_LIMIT);
    expect(body.counts).toEqual({
      renders: TODAY_RENDER_LIMIT + 2,
      saves: TODAY_SAVE_LIMIT + 2,
    });
  });

  it("caps the quiet tracks and counts every one in the total", async () => {
    today.requireProject();
    const created: number[] = [];
    for (let i = 0; i < QUIET_LIMIT + 2; i++) {
      created.push(await today.mkTrack(`Quiet ${i}`));
    }
    await db
      .update(tracks)
      .set({ updatedAt: ago(60 * 24 * HOUR_MS) })
      .where(inArray(tracks.id, created));
    const { quiet } = await readToday();
    expect(quiet.tracks).toHaveLength(QUIET_LIMIT);
    expect(quiet.total).toBe(QUIET_LIMIT + 2);
  });

  it("reads its windows from the project: a longer today window and a shorter quiet threshold", async () => {
    today.requireProject();
    const older = await trackWithRender("Two days ago", 47 * HOUR_MS);
    const sleepy = await today.mkTrack("Quiet for a week");
    await db
      .update(tracks)
      .set({ updatedAt: ago(8 * 24 * HOUR_MS) })
      .where(eq(tracks.id, sleepy));

    const body = await withProjectPolicyForTest(
      today.projectId,
      { conventions: { todayNewHours: 48, quietAfterDays: 7 } },
      () => readToday()
    );

    expect(body.renders.map((r) => r.trackId)).toEqual([older]);
    expect(body.quiet.tracks.map((t) => t.id)).toEqual([sleepy]);
  });

  it("counts nothing quiet at a threshold of 0", async () => {
    today.requireProject();
    const old = await today.mkTrack("Long untouched");
    await db
      .update(tracks)
      .set({ updatedAt: ago(90 * 24 * HOUR_MS) })
      .where(eq(tracks.id, old));

    const { quiet } = await withProjectPolicyForTest(
      today.projectId,
      { conventions: { quietAfterDays: 0 } },
      () => readToday()
    );

    expect(quiet).toEqual({ tracks: [], total: 0 });
  });
});

describe("project jobs", () => {
  const MINUTE_AGO = () => new Date(Date.now() - 60_000);

  type ListedJob = {
    id: number;
    status: string;
    label: string;
    subjectLabel: string | null;
  };

  /**
   * One row of each status, with done and cancelled both fresh and stale.
   * Earlier tests in the file queue jobs of their own, so reads are compared
   * on these rows only.
   */
  async function seedJobs() {
    const asset = await uploadAsset(`jobs-${Date.now()}.wav`);
    const row = (values: Partial<typeof jobs.$inferInsert>) => ({
      projectId: suite.projectId,
      kind: "convert" as const,
      subjectId: asset.id,
      ...values,
    });
    const [
      queued,
      running,
      failed,
      freshDone,
      staleDone,
      freshCancel,
      staleCancel,
    ] = await db
      .insert(jobs)
      .values([
        row({ status: "queued" }),
        row({ status: "running", startedAt: new Date() }),
        row({ status: "failed", finishedAt: MINUTE_AGO() }),
        row({ status: "done", finishedAt: new Date() }),
        row({ status: "done", finishedAt: MINUTE_AGO() }),
        row({ status: "cancelled", finishedAt: new Date() }),
        row({ status: "cancelled", finishedAt: MINUTE_AGO() }),
      ])
      .returning({ id: jobs.id });

    const ids = {
      queued: queued!.id,
      running: running!.id,
      failed: failed!.id,
      freshDone: freshDone!.id,
      staleDone: staleDone!.id,
      freshCancel: freshCancel!.id,
      staleCancel: staleCancel!.id,
    };
    return {
      asset,
      ids,
      cleanUp: () =>
        db.delete(jobs).where(inArray(jobs.id, Object.values(ids))),
    };
  }

  it("collapses active, failed and recently finished jobs into one read", async () => {
    requireProject();
    const { asset, ids, cleanUp } = await seedJobs();

    try {
      const res = await request(
        "viewer",
        `/projects/${suite.projectId}/jobs?status=queued,running,failed,done,cancelled&recentMs=10000`
      );
      expect(res.status).toBe(200);

      const seeded = new Set(Object.values(ids));
      const listed = ((await res.json()) as ListedJob[]).filter((job) =>
        seeded.has(job.id)
      );
      expect(listed.map((job) => job.id)).toEqual([
        ids.freshCancel,
        ids.freshDone,
        ids.failed,
        ids.running,
        ids.queued,
      ]);
      for (const job of listed) {
        expect(job.label).toBe("Converting");
        expect(job.subjectLabel).toBe(asset.name);
      }
    } finally {
      await cleanUp();
    }
  });

  it("still narrows to a single status, and refuses an unknown one", async () => {
    requireProject();
    const { ids, cleanUp } = await seedJobs();

    try {
      const failed = await request(
        "viewer",
        `/projects/${suite.projectId}/jobs?status=failed`
      );
      expect(failed.status).toBe(200);
      const listed = (await failed.json()) as ListedJob[];
      expect(listed.every((job) => job.status === "failed")).toBe(true);
      expect(listed.map((job) => job.id)).toContain(ids.failed);

      const unknown = await request(
        "viewer",
        `/projects/${suite.projectId}/jobs?status=queued,paused`
      );
      expect(unknown.status).toBe(400);
    } finally {
      await cleanUp();
    }
  });
  it("opens the event stream with a snapshot and follows it with job events", async () => {
    requireProject();
    const { ids, cleanUp } = await seedJobs();
    const connection = new AbortController();

    try {
      const res = await request(
        "viewer",
        `/projects/${suite.projectId}/jobs/events`,
        { signal: connection.signal }
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      // Next's rewrite gzips whatever it may transform, and a gzip stream holds
      // events back until its buffer fills.
      expect(res.headers.get("cache-control")).toContain("no-transform");
      const events = sseReader(res.body!);

      const snapshot = await events.next();
      expect(snapshot.event).toBe("snapshot");
      const seeded = new Set(Object.values(ids));
      expect(
        (JSON.parse(snapshot.data) as ListedJob[])
          .filter((job) => seeded.has(job.id))
          .map((job) => job.id)
      ).toEqual([
        ids.freshCancel,
        ids.freshDone,
        ids.failed,
        ids.running,
        ids.queued,
      ]);

      publishJob({ ...(await getJob(ids.running)), percent: 42 });

      const change = await events.next();
      expect(change.event).toBe("job");
      expect(change.id).toBe(String(ids.running));
      expect(JSON.parse(change.data)).toMatchObject({
        id: ids.running,
        percent: 42,
        label: "Converting",
      });
    } finally {
      connection.abort();
      await cleanUp();
    }

    await waitFor(() => expect(projectListenerCount(suite.projectId)).toBe(0));
  });

  it(
    "writes to a quiet event stream before the server's idle timeout closes it",
    async () => {
      requireProject();
      const connection = new AbortController();

      try {
        const res = await request(
          "viewer",
          `/projects/${suite.projectId}/jobs/events`,
          { signal: connection.signal }
        );
        const events = sseReader(res.body!);
        expect((await events.next()).event).toBe("snapshot");

        // Jobs queued by earlier tests may still report; only a ping shows the
        // stream writes when nothing changes.
        const deadline = Date.now() + IDLE_TIMEOUT_SECONDS * 1000;
        let event = await events.next(deadline - Date.now());
        while (event.event !== "ping") {
          event = await events.next(deadline - Date.now());
        }
      } finally {
        connection.abort();
      }

      await waitFor(() =>
        expect(projectListenerCount(suite.projectId)).toBe(0)
      );
    },
    IDLE_TIMEOUT_SECONDS * 1000 + 5_000
  );

  it("keeps the event stream to the project's members", async () => {
    requireProject();
    await expectAccess("GET", `/projects/${suite.projectId}/jobs/events`, {});
  });
});
