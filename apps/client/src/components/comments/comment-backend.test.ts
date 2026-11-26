import { describe, expect, it, mock } from "bun:test";
import type { CommentBackend } from "./comment-backend";

mock.module("@/actions/comments", () => ({
  createComment: mock(),
  deleteComment: mock(),
  getCommentsForTarget: mock(),
  reopenComment: mock(),
  resolveComment: mock(),
  updateComment: mock(),
}));

const { canAmend, canReply, canResolve } = await import("./comment-backend");

const backend = (over: Partial<CommentBackend> = {}) =>
  ({
    list: mock(),
    create: mock(),
    update: mock(),
    remove: mock(),
    ...over,
  }) as CommentBackend;

const comment = (viewerCan: { amend: boolean; resolve: boolean }) => ({
  viewerCan,
});

describe("canAmend", () => {
  it("follows the comment's amend flag whatever the viewer id is", () => {
    const yes = comment({ amend: true, resolve: false });
    const no = comment({ amend: false, resolve: false });

    expect(canAmend(backend({ viewerId: null }), yes)).toBe(true);
    expect(canAmend(backend({ viewerId: "u1" }), no)).toBe(false);
    expect(canAmend(backend(), yes)).toBe(true);
    expect(canAmend(backend(), no)).toBe(false);
  });
});

describe("canResolve", () => {
  it("needs both the comment's resolve flag and a backend that can resolve", () => {
    const resolvable = backend({ resolve: mock(), reopen: mock() });

    expect(
      canResolve(resolvable, comment({ amend: false, resolve: true }))
    ).toBe(true);
    expect(
      canResolve(resolvable, comment({ amend: true, resolve: false }))
    ).toBe(false);
  });

  it("is false on a backend without resolve even when the flag is true", () => {
    expect(canResolve(backend(), comment({ amend: true, resolve: true }))).toBe(
      false
    );
  });
});

describe("canReply", () => {
  it("is false only for a reader with no identity", () => {
    expect(canReply(backend({ viewerId: null }))).toBe(false);
    expect(canReply(backend({ viewerId: "u1" }))).toBe(true);
    expect(canReply(backend())).toBe(true);
  });
});
