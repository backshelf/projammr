import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { CommentWithReplies } from "@workspace/api/api";
import { SectionFold } from "@workspace/ui/components/layout/empty-section";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { PoliciesProvider } from "@/lib/policies/provider";
import type { CommentBackend } from "./comment-backend";

import * as playerHooks from "@/components/music-player/player-hooks";

mock.module("@/actions/comments", () => ({
  createComment: mock(),
  deleteComment: mock(),
  getCommentsForTarget: mock(),
  reopenComment: mock(),
  resolveComment: mock(),
  updateComment: mock(),
}));
mock.module("sonner", () => ({ toast: { error: mock() } }));
mock.module("@/components/music-player/player-hooks", () => ({
  ...playerHooks,
  useCurrentAssetId: () => 50,
  useMusicPlayerStore: () => ({ getProgress: () => 0 }),
  usePlayerActions: () => ({ playAt: mock(), seek: mock() }),
}));

const makeComment = (
  over: Partial<CommentWithReplies> & { id: number }
): CommentWithReplies =>
  ({
    content: `comment ${over.id}`,
    targetType: "track",
    targetId: 10,
    parentId: null,
    positionMs: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    resolvedAt: null,
    resolvedBy: null,
    resolver: null,
    user: { id: "u1", name: "Ada" },
    viewerCan: { amend: false, resolve: true },
    replies: [],
    ...over,
  }) as unknown as CommentWithReplies;

const mixComment = makeComment({
  id: 1,
  targetType: "track_audio",
  targetId: 20,
  positionMs: 12000,
  content: "Kick is too hot",
  createdAt: "2026-10-01T09:00:00.000Z",
});

const generalComment = makeComment({
  id: 2,
  targetType: "track",
  targetId: 10,
  content: "Bridge feels strong",
  createdAt: "2026-10-01T11:00:00.000Z",
});

mock.module("@/components/track-audio/TrackAudioContext", () => ({
  useTrackAudio: () => ({
    selected: {
      id: 20,
      version: 3,
      assetId: 50,
      isPrimary: true,
      lufs: -10,
      asset: { id: 50, name: "v3.wav", assetPath: "a/50.wav" },
    },
    comments: [mixComment],
    reloadComments: mock(),
  }),
}));

const { CommentBackendProvider } = await import("./comment-backend");
const { TrackCommentsSection } = await import("./TrackCommentsSection");

const backend = {
  list: mock(),
  create: mock(),
  update: mock(),
  remove: mock(),
} as unknown as CommentBackend;

afterEach(cleanup);

function renderUnified() {
  return render(
    <MotionProvider>
      <PoliciesProvider policies={DEFAULT_POLICIES}>
        <CommentBackendProvider backend={backend}>
          <SectionFold>
            <TrackCommentsSection
              trackId={10}
              trackTitle="Nightfall"
              artists={[]}
              generalComments={[generalComment]}
            />
          </SectionFold>
        </CommentBackendProvider>
      </PoliciesProvider>
    </MotionProvider>
  );
}

describe("TrackCommentsSection", () => {
  it("unifies All, vN Mix notes, and General tabs in the track body", () => {
    renderUnified();

    expect(screen.getByRole("tab", { name: /All/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /v3 Mix notes/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /General/ })).toBeTruthy();

    // All tab renders both mix notes and general comments.
    expect(screen.getByText("Kick is too hot")).toBeTruthy();
    expect(screen.getByText("Bridge feels strong")).toBeTruthy();

    // Switching to v3 Mix notes isolates mix notes.
    fireEvent.click(screen.getByRole("tab", { name: /v3 Mix notes/ }));
    expect(screen.getByText("Kick is too hot")).toBeTruthy();
    expect(screen.queryByText("Bridge feels strong")).toBeNull();

    // Switching to General isolates general song comments.
    fireEvent.click(screen.getByRole("tab", { name: /General/ }));
    expect(screen.queryByText("Kick is too hot")).toBeNull();
    expect(screen.getByText("Bridge feels strong")).toBeTruthy();
  });
});
