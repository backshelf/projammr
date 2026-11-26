import { describe, expect, it } from "bun:test";
import { resolveComment } from "../db/queries/comments.js";
import { setupSuite } from "../test/fixtures.js";

const suite = setupSuite("Comments");
const { owner, requireProject, request, expectAccess, mkTrack, uploadAsset } =
  suite;

describe("comments", () => {
  it("creates, reads, updates, and deletes a comment on a track", async () => {
    requireProject();
    const trackId = await mkTrack("Commented Track");

    const created = await request("owner", "/comments", {
      method: "POST",
      body: JSON.stringify({
        targetType: "track",
        targetId: trackId,
        content: "First comment",
      }),
    });
    expect(created.status).toBe(201);
    const comment = await created.json();
    expect(comment.content).toBe("First comment");

    const reply = await request("owner", "/comments", {
      method: "POST",
      body: JSON.stringify({
        targetType: "track",
        targetId: trackId,
        content: "A reply",
        parentId: comment.id,
      }),
    });
    expect(reply.status).toBe(201);

    const list = await request("viewer", `/comments/track/${trackId}`);
    expect(list.status).toBe(200);
    const threads = (await list.json()) as {
      id: number;
      replies: { id: number }[];
    }[];
    const thread = threads.find((t) => t.id === comment.id)!;
    expect(thread.replies).toHaveLength(1);

    const patched = await request("owner", `/comments/${comment.id}`, {
      method: "PATCH",
      body: JSON.stringify({ content: "Edited comment" }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).content).toBe("Edited comment");

    const deleted = await request("owner", `/comments/${comment.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
  });

  it("reports what the viewer may do with each comment in the thread", async () => {
    requireProject();
    const trackId = await mkTrack("Viewer Can Track");
    const post = async (
      caller: "owner" | "editor" | "viewer",
      content: string,
      parentId?: number
    ) => {
      const res = await request(caller, "/comments", {
        method: "POST",
        body: JSON.stringify({
          targetType: "track",
          targetId: trackId,
          content,
          parentId,
        }),
      });
      expect(res.status).toBe(201);
      return (await res.json()) as {
        id: number;
        resolver: unknown;
        viewerCan: { amend: boolean; resolve: boolean };
      };
    };

    const byViewer = await post("viewer", "A viewer's note");
    const byOwner = await post("owner", "The owner's note");
    const ownerReply = await post("owner", "The owner replies", byViewer.id);

    // A write answers with the flags for the person who made it.
    expect(byViewer.resolver).toBeNull();
    expect(byViewer.viewerCan).toEqual({ amend: true, resolve: true });

    type Thread = {
      id: number;
      resolver: unknown;
      viewerCan: { amend: boolean; resolve: boolean };
      replies: Thread[];
    };
    const read = async (caller: "owner" | "editor" | "viewer") => {
      const res = await request(caller, `/comments/track/${trackId}`);
      expect(res.status).toBe(200);
      const threads = (await res.json()) as Thread[];
      return {
        viewer: threads.find((t) => t.id === byViewer.id)!,
        owner: threads.find((t) => t.id === byOwner.id)!,
      };
    };

    const asViewer = await read("viewer");
    expect(asViewer.viewer.resolver).toBeNull();
    expect(asViewer.viewer.viewerCan).toEqual({ amend: true, resolve: true });
    expect(asViewer.owner.viewerCan).toEqual({ amend: false, resolve: false });

    // An owner who is not the author may resolve, not amend.
    const asOwner = await read("owner");
    expect(asOwner.viewer.viewerCan).toEqual({ amend: false, resolve: true });
    expect(asOwner.owner.viewerCan).toEqual({ amend: true, resolve: true });

    const asEditor = await read("editor");
    expect(asEditor.viewer.viewerCan).toEqual({ amend: false, resolve: true });

    // A reply is never resolved on its own, even by its own author, who may still amend it.
    const reply = asOwner.viewer.replies.find((r) => r.id === ownerReply.id)!;
    expect(reply.resolver).toBeNull();
    expect(reply.viewerCan).toEqual({ amend: true, resolve: false });
    expect(asViewer.viewer.replies[0]!.viewerCan).toEqual({
      amend: false,
      resolve: false,
    });
  });

  it("refuses resolve state in a comment's create or edit body", async () => {
    requireProject();
    const trackId = await mkTrack("Resolve Fields Track");

    for (const extra of [
      { resolvedAt: new Date().toISOString() },
      { resolvedBy: owner.userId },
    ]) {
      const created = await request("owner", "/comments", {
        method: "POST",
        body: JSON.stringify({
          targetType: "track",
          targetId: trackId,
          content: "Resolved on arrival",
          ...extra,
        }),
      });
      // The field is not in the body schema, so it is dropped, not stored.
      expect(created.status).toBe(201);
      const body = await created.json();
      expect(body.resolvedAt).toBeNull();
      expect(body.resolvedBy).toBeNull();
    }

    const created = await request("owner", "/comments", {
      method: "POST",
      body: JSON.stringify({
        targetType: "track",
        targetId: trackId,
        content: "Open",
      }),
    });
    const comment = await created.json();
    const patched = await request("owner", `/comments/${comment.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        content: "Still open",
        resolvedAt: new Date().toISOString(),
      }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).resolvedAt).toBeNull();
  });

  it("keeps email addresses out of a comment thread", async () => {
    requireProject();
    const trackId = await mkTrack("Private Comment Track");

    const created = await request("owner", "/comments", {
      method: "POST",
      body: JSON.stringify({
        targetType: "track",
        targetId: trackId,
        content: "Root",
      }),
    });
    expect(created.status).toBe(201);
    const comment = await created.json();
    expect(comment.user).not.toHaveProperty("email");

    const reply = await request("editor", "/comments", {
      method: "POST",
      body: JSON.stringify({
        targetType: "track",
        targetId: trackId,
        content: "Reply",
        parentId: comment.id,
      }),
    });
    expect(reply.status).toBe(201);

    const list = await request("viewer", `/comments/track/${trackId}`);
    expect(list.status).toBe(200);
    const threads = (await list.json()) as {
      id: number;
      user: Record<string, unknown>;
      replies: { user: Record<string, unknown> }[];
    }[];
    const thread = threads.find((t) => t.id === comment.id)!;
    expect(thread.user).not.toHaveProperty("email");
    expect(thread.user.name).toBe(owner.name);
    expect(thread.replies).toHaveLength(1);
    expect(thread.replies[0]!.user).not.toHaveProperty("email");

    const patched = await request("owner", `/comments/${comment.id}`, {
      method: "PATCH",
      body: JSON.stringify({ content: "Edited" }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).user).not.toHaveProperty("email");
  });

  it("orders audio comments with the un-positioned ones first", async () => {
    requireProject();
    const trackId = await mkTrack("Ordered Comments Track");
    const asset = await uploadAsset("ordered-comments.wav");

    const linked = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [asset.id] }),
    });
    expect(linked.status).toBe(201);
    const audioId = ((await linked.json()) as { audios: { id: number }[] })
      .audios[0]!.id;

    // Posted deliberately out of order, and general-before-general in creation
    // order so the createdAt tie-break is exercised too.
    const posted = [
      { content: "marker late", positionMs: 5000 },
      { content: "general first", positionMs: null },
      { content: "marker early", positionMs: 1000 },
      { content: "general second", positionMs: null },
    ];
    for (const body of posted) {
      const res = await request("owner", "/comments", {
        method: "POST",
        body: JSON.stringify({
          targetType: "track_audio",
          targetId: audioId,
          ...body,
        }),
      });
      expect(res.status).toBe(201);
    }

    const list = await request("viewer", `/comments/track_audio/${audioId}`);
    expect(list.status).toBe(200);
    const threads = (await list.json()) as {
      content: string;
      positionMs: number | null;
    }[];
    expect(threads.map((t) => t.content)).toEqual([
      "general first",
      "general second",
      "marker early",
      "marker late",
    ]);
  });

  it("400s an unknown comment target type", async () => {
    requireProject();
    const res = await request("owner", "/comments/not-a-type/1");
    // The resolver cannot map the segment to a target, so the gate 404s before
    // the handler's own 400.
    expect(res.status).toBe(404);
  });

  it("refuses to edit or delete another member's comment", async () => {
    requireProject();
    const trackId = await mkTrack("Ownership Track");

    const created = await request("owner", "/comments", {
      method: "POST",
      body: JSON.stringify({
        targetType: "track",
        targetId: trackId,
        content: "Owner's words",
      }),
    });
    expect(created.status).toBe(201);
    const comment = await created.json();

    // Neither role owns this comment, however much of the project they can write.
    for (const role of ["editor", "viewer"] as const) {
      const edit = await request(role, `/comments/${comment.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: "Not mine to edit" }),
      });
      expect(edit.status).toBe(403);

      const del = await request(role, `/comments/${comment.id}`, {
        method: "DELETE",
      });
      expect(del.status).toBe(403);
    }

    // The refused delete left the comment in place.
    const stillThere = await request("viewer", `/comments/track/${trackId}`);
    const threads = (await stillThere.json()) as { id: number }[];
    expect(threads.some((t) => t.id === comment.id)).toBe(true);
  });

  it("lets a viewer comment, then edit and delete their own comment", async () => {
    requireProject();
    const trackId = await mkTrack("Viewer Comment Track");

    const created = await request("viewer", "/comments", {
      method: "POST",
      body: JSON.stringify({
        targetType: "track",
        targetId: trackId,
        content: "A viewer's thought",
      }),
    });
    expect(created.status).toBe(201);
    const comment = await created.json();

    const patched = await request("viewer", `/comments/${comment.id}`, {
      method: "PATCH",
      body: JSON.stringify({ content: "A better thought" }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).content).toBe("A better thought");

    const deleted = await request("viewer", `/comments/${comment.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
  });

  it("gates comment endpoints by membership, not by write role", async () => {
    requireProject();
    const trackId = await mkTrack("Gated Comment Track");

    // `expectAccess` itself checks that a non-member gets 404 on each call.
    await expectAccess("GET", `/comments/track/${trackId}`, { viewer: 200 });

    // Posting a comment resolves the project through the named target.
    await expectAccess(
      "POST",
      "/comments",
      { viewer: 201, editor: 201 },
      { targetType: "track", targetId: trackId, content: "Gated" }
    );

    const editorComment = await (
      await request("editor", "/comments", {
        method: "POST",
        body: JSON.stringify({
          targetType: "track",
          targetId: trackId,
          content: "Editor's own",
        }),
      })
    ).json();

    await expectAccess(
      "PATCH",
      `/comments/${editorComment.id}`,
      { viewer: 403, editor: 200 },
      { content: "Editor edits their own" }
    );
    await expectAccess("DELETE", `/comments/${editorComment.id}`, {
      viewer: 403,
      editor: 204,
    });
  });

  describe("resolve", () => {
    type Caller = "owner" | "editor" | "viewer";
    type Resolvable = {
      id: number;
      resolvedAt: string | null;
      resolvedBy: string | null;
      updatedAt: string;
      resolver: { id: string } | null;
      viewerCan: { amend: boolean; resolve: boolean };
    };

    async function post(
      caller: Caller,
      trackId: number,
      content: string,
      parentId?: number
    ) {
      const res = await request(caller, "/comments", {
        method: "POST",
        body: JSON.stringify({
          targetType: "track",
          targetId: trackId,
          content,
          parentId,
        }),
      });
      expect(res.status).toBe(201);
      return (await res.json()) as Resolvable;
    }

    const resolve = (caller: Caller, id: number, method = "POST") =>
      request(caller, `/comments/${id}/resolve`, { method });

    it("lets the author resolve their own comment, even as a viewer", async () => {
      requireProject();
      const comment = await post(
        "viewer",
        await mkTrack("Resolve Own"),
        "Mine"
      );

      const res = await resolve("viewer", comment.id);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Resolvable;
      expect(body.resolvedAt).not.toBeNull();
      expect(body.resolvedBy).toBe(suite.viewer.userId);
      expect(body.resolver?.id).toBe(suite.viewer.userId);
    });

    it("lets an editor or better resolve another member's comment as themselves", async () => {
      requireProject();
      const trackId = await mkTrack("Resolve Other");

      for (const caller of ["owner", "editor"] as const) {
        const comment = await post("viewer", trackId, `For ${caller}`);
        const res = await resolve(caller, comment.id);
        expect(res.status).toBe(200);
        const body = (await res.json()) as Resolvable;
        expect(body.resolvedAt).not.toBeNull();
        expect(body.resolver?.id).toBe(suite[caller].userId);
      }
    });

    it("refuses a viewer who did not write the comment", async () => {
      requireProject();
      const comment = await post(
        "owner",
        await mkTrack("Resolve Refused"),
        "x"
      );

      for (const method of ["POST", "DELETE"]) {
        const res = await resolve("viewer", comment.id, method);
        expect(res.status).toBe(403);
        expect((await res.json()).error).toBe(
          "Only the author or a project editor can resolve a comment"
        );
      }
    });

    it("refuses a reply with 400 before it checks the caller's rights", async () => {
      requireProject();
      const trackId = await mkTrack("Resolve Reply");
      const root = await post("owner", trackId, "Root");
      const reply = await post("owner", trackId, "Reply", root.id);

      // The viewer would be refused on rights, so a 400 shows the reply check ran first.
      for (const caller of ["owner", "viewer"] as const) {
        expect((await resolve(caller, reply.id)).status).toBe(400);
        expect((await resolve(caller, reply.id, "DELETE")).status).toBe(400);
      }
    });

    it("answers 404 for a missing comment and one in another project", async () => {
      requireProject();
      const other = await suite.throwawayProject("Resolve Foreign");
      const track = await suite.requestAs(other.owner, "/tracks", {
        method: "POST",
        body: JSON.stringify({
          title: "Foreign Track",
          artists: ["A"],
          projectId: other.id,
        }),
      });
      const foreign = await suite.requestAs(other.owner, "/comments", {
        method: "POST",
        body: JSON.stringify({
          targetType: "track",
          targetId: (await track.json()).id,
          content: "Elsewhere",
        }),
      });
      expect(foreign.status).toBe(201);

      expect((await resolve("owner", (await foreign.json()).id)).status).toBe(
        404
      );
      expect((await resolve("owner", 2_000_000_000)).status).toBe(404);
    });

    it("keeps the original resolver and time when a resolved comment is resolved again", async () => {
      requireProject();
      const comment = await post("viewer", await mkTrack("Resolve Twice"), "x");

      const first = (await (
        await resolve("owner", comment.id)
      ).json()) as Resolvable;
      const second = await resolve("editor", comment.id);
      expect(second.status).toBe(200);
      const body = (await second.json()) as Resolvable;
      expect(body.resolvedAt).toBe(first.resolvedAt!);
      expect(body.resolver?.id).toBe(suite.owner.userId);
      expect(body.updatedAt).toBe(first.updatedAt);
    });

    it("reopens a resolved comment and leaves an open one open", async () => {
      requireProject();
      const trackId = await mkTrack("Reopen");
      const comment = await post("owner", trackId, "x");

      const untouched = await resolve("owner", comment.id, "DELETE");
      expect(untouched.status).toBe(200);
      const open = (await untouched.json()) as Resolvable;
      expect(open.resolvedAt).toBeNull();
      expect(open.updatedAt).toBe(comment.updatedAt);

      await resolve("owner", comment.id);
      const reopened = await resolve("editor", comment.id, "DELETE");
      expect(reopened.status).toBe(200);
      const body = (await reopened.json()) as Resolvable;
      expect(body.resolvedAt).toBeNull();
      expect(body.resolvedBy).toBeNull();
      expect(body.resolver).toBeNull();
    });

    it("shows the resolver and the caller's rights in the thread, and clears both on reopen", async () => {
      requireProject();
      const trackId = await mkTrack("Resolve Thread");
      const comment = await post("viewer", trackId, "x");

      const read = async () => {
        const res = await request("editor", `/comments/track/${trackId}`);
        return ((await res.json()) as Resolvable[]).find(
          (t) => t.id === comment.id
        )!;
      };

      await resolve("editor", comment.id);
      const resolved = await read();
      expect(resolved.resolvedAt).not.toBeNull();
      expect(resolved.resolver?.id).toBe(suite.editor.userId);
      expect(resolved.viewerCan.resolve).toBe(true);

      await resolve("editor", comment.id, "DELETE");
      const reopened = await read();
      expect(reopened.resolvedAt).toBeNull();
      expect(reopened.resolver).toBeNull();
    });

    it("gates the resolve routes by membership and by the author-or-editor rule", async () => {
      requireProject();
      const comment = await post("owner", await mkTrack("Resolve Gate"), "x");

      await expectAccess("POST", `/comments/${comment.id}/resolve`, {
        viewer: 403,
        editor: 200,
      });
      await expectAccess("DELETE", `/comments/${comment.id}/resolve`, {
        viewer: 403,
        editor: 200,
      });
      // No PUT route: the mount's default editor floor answers first, then nothing matches.
      await expectAccess("PUT", `/comments/${comment.id}/resolve`, {
        viewer: 403,
        editor: 404,
      });
    });

    it("reports a change for exactly one of two concurrent resolves", async () => {
      requireProject();
      const comment = await post("viewer", await mkTrack("Resolve Race"), "x");
      const actor = { userId: suite.owner.userId, role: "owner" as const };

      const results = await Promise.all([
        resolveComment(comment.id, actor),
        resolveComment(comment.id, actor),
      ]);
      expect(results.filter((r) => r.changed)).toHaveLength(1);
      expect(results[0].comment.resolvedAt).not.toBeNull();
    });

    describe("activity", () => {
      type Row = {
        action: string;
        entityType: string;
        entityId: number;
        commentId: number | null;
      };

      async function commentRows(trackId: number, commentId: number) {
        const res = await request(
          "owner",
          `/projects/${suite.projectId}/activity?entityType=track&entityId=${trackId}`
        );
        expect(res.status).toBe(200);
        return ((await res.json()) as Row[]).filter(
          (row) => row.commentId === commentId
        );
      }

      it("logs a resolved row against the commented entity", async () => {
        requireProject();
        const trackId = await mkTrack("Resolve Activity");
        const comment = await post("viewer", trackId, "x");
        await resolve("owner", comment.id);

        const rows = await commentRows(trackId, comment.id);
        expect(rows.map((row) => row.action).sort()).toEqual([
          "commented",
          "resolved",
        ]);
        const row = rows.find((r) => r.action === "resolved")!;
        expect(row.entityType).toBe("track");
        expect(row.entityId).toBe(trackId);
        expect(row.commentId).toBe(comment.id);
      });

      it("logs a reopened row against the commented entity", async () => {
        requireProject();
        const trackId = await mkTrack("Reopen Activity");
        const comment = await post("viewer", trackId, "x");
        await resolve("owner", comment.id);
        await resolve("owner", comment.id, "DELETE");

        const rows = await commentRows(trackId, comment.id);
        const row = rows.find((r) => r.action === "reopened")!;
        expect(row.entityType).toBe("track");
        expect(row.entityId).toBe(trackId);
        expect(row.commentId).toBe(comment.id);
      });

      it("logs nothing for a second resolve", async () => {
        requireProject();
        const trackId = await mkTrack("Resolve Twice Activity");
        const comment = await post("viewer", trackId, "x");
        await resolve("owner", comment.id);
        await resolve("editor", comment.id);

        const rows = await commentRows(trackId, comment.id);
        expect(rows.filter((r) => r.action === "resolved")).toHaveLength(1);
      });

      it("logs nothing for a reopen of an open comment", async () => {
        requireProject();
        const trackId = await mkTrack("Reopen Open Activity");
        const comment = await post("viewer", trackId, "x");
        await resolve("owner", comment.id, "DELETE");

        const rows = await commentRows(trackId, comment.id);
        expect(rows.map((r) => r.action)).toEqual(["commented"]);
      });
    });
  });
});
