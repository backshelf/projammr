import { isInsufficientScopeError } from "better-auth/oauth2";
import { describe, expect, it } from "bun:test";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { setupSuite } from "../test/fixtures.js";
import type { Actor } from "./actor.js";
import {
  requireEntity,
  requireProject,
  requireScope,
  toolFailure,
} from "./authorize.js";

const suite = setupSuite("MCP authorize");
const { viewer, editor, mkTrack } = suite;

function actorFor(
  userId: string,
  scopes: Iterable<
    Actor["scopes"] extends ReadonlySet<infer S> ? S : never
  > = []
): Actor {
  return {
    id: userId,
    name: "",
    scopes: new Set(scopes),
    user: {} as Actor["user"],
  };
}

describe("requireProject", () => {
  it("grants a caller whose role satisfies the minimum", async () => {
    suite.requireProject();
    const gate = await requireProject(
      actorFor(editor.userId),
      suite.projectId,
      "editor"
    );
    expect(gate).toEqual({ projectId: suite.projectId, role: "editor" });
  });

  it("refuses a viewer against an editor gate with the HTTP gate's own 403 text", async () => {
    suite.requireProject();
    await expect(
      requireProject(actorFor(viewer.userId), suite.projectId, "editor")
    ).rejects.toMatchObject({
      status: 403,
      message: "Requires project role: editor",
    });
  });
});

describe("requireEntity", () => {
  it("gates on the project a track belongs to", async () => {
    suite.requireProject();
    const trackId = await mkTrack("MCP authorize track");
    const gate = await requireEntity(
      actorFor(editor.userId),
      "track",
      trackId,
      "viewer"
    );
    expect(gate.projectId).toBe(suite.projectId);
  });

  it("answers 404 for an id with no row, not a leaked existence check", async () => {
    suite.requireProject();
    await expect(
      requireEntity(actorFor(editor.userId), "track", 999_999_999, "viewer")
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("requireScope", () => {
  it("passes silently when the actor holds the scope", () => {
    expect(() => requireScope(actorFor("u", ["write"]), "write")).not.toThrow();
  });

  it("throws the OAuth provider's insufficient-scope error otherwise", () => {
    try {
      requireScope(actorFor("u", ["read"]), "write");
      throw new Error("expected requireScope to throw");
    } catch (err) {
      expect(isInsufficientScopeError(err)).toBe(true);
    }
  });
});

describe("toolFailure", () => {
  it("maps an HTTPException to its status and message", () => {
    const err = new HTTPException(403, {
      message: "Requires project role: editor",
    });
    expect(toolFailure(err)).toEqual({
      status: 403,
      message: "Requires project role: editor",
    });
  });

  it("turns a ZodError into a 400 message naming the field", () => {
    const result = z.object({ title: z.string() }).safeParse({ title: 1 });
    if (result.success) throw new Error("expected the parse to fail");
    const failure = toolFailure(result.error);
    expect(failure.status).toBe(400);
    expect(failure.message).toContain("title");
  });

  it("rethrows anything else", () => {
    const bug = new Error("not a known failure shape");
    expect(() => toolFailure(bug)).toThrow(bug);
  });
});
