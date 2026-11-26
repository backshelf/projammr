import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { PoliciesProvider } from "@/lib/policies/provider";
import type { CommentBackend } from "@/components/comments/comment-backend";

mock.module("@/actions/comments", () => ({
  createComment: mock(),
  deleteComment: mock(),
  getCommentsForTarget: mock(),
  reopenComment: mock(),
  resolveComment: mock(),
  updateComment: mock(),
}));
mock.module("sonner", () => ({ toast: { error: mock() } }));

const LOADED_ASSET = 9;
mock.module("@/components/music-player/player-hooks", () => ({
  useCurrentAssetId: () => LOADED_ASSET,
  useMusicPlayerStore: () => ({ getProgress: () => 0 }),
  usePlayerActions: () => ({ seek: mock() }),
  // The compose scope's push (`commands/provider.tsx`) imports these three at
  // module load; unused here, but the named import fails without them.
  useCurrentTrack: () => null,
  useDuration: () => 0,
  useLabSettings: () => ({}),
}));

const { CommentBackendProvider } =
  await import("@/components/comments/comment-backend");
const { AudioCommentSection } = await import("./AudioCommentSection");

afterEach(cleanup);

const backend = {
  list: mock(),
  create: mock(),
  update: mock(),
  remove: mock(),
} as unknown as CommentBackend;

function renderSection({
  assetId = LOADED_ASSET,
  audioCommentPinned,
}: {
  assetId?: number;
  audioCommentPinned?: boolean;
} = {}) {
  const policies =
    audioCommentPinned === undefined
      ? DEFAULT_POLICIES
      : {
          ...DEFAULT_POLICIES,
          shell: { ...DEFAULT_POLICIES.shell, audioCommentPinned },
        };
  render(
    <PoliciesProvider policies={policies}>
      <CommentBackendProvider backend={backend}>
        <AudioCommentSection
          trackAudioId={5}
          assetId={assetId}
          comments={[]}
          onCommentsChange={() => {}}
          registerScrollTarget={() => {}}
        />
      </CommentBackendProvider>
    </PoliciesProvider>
  );
}

describe("AudioCommentSection's pin", () => {
  it("starts a comment on the loaded audio pinned to the playhead, by default", () => {
    renderSection();

    expect(screen.getByText("At 0:00")).toBeTruthy();
  });

  it("starts it as a general comment when the viewer's policy does not pin", () => {
    renderSection({ audioCommentPinned: false });

    expect(screen.getByText("General comment")).toBeTruthy();
  });

  it("never pins a comment on audio that is not loaded", () => {
    renderSection({ assetId: LOADED_ASSET + 1 });

    expect(screen.queryByText(/^At /)).toBeNull();
  });
});
