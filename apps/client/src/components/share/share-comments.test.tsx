import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import type { Sharelink } from "@workspace/api/api";
import type { ShareEntry } from "@/components/share/share-playables";
import type { ShareRoom } from "@/components/share/ShareRoom";

const seek = mock();
const reload = mock();

const currentAssetIdStub = () => null;
const playerActionsStub = () => ({});
const commentThreadStub = () => ({});

mock.module("server-only", () => ({}));
mock.module("@/components/music-player/player-hooks", () => ({
  useCurrentAssetId: currentAssetIdStub,
  usePlayerActions: playerActionsStub,
  // The compose scope's push (`commands/provider.tsx`) imports these three at
  // module load; unused here, but the named import fails without them.
  useCurrentTrack: () => null,
  useDuration: () => 0,
  useMusicPlayerStore: () => ({}),
  useLabSettings: () => ({}),
}));
mock.module("@/components/art/ArtProvider", () => ({
  ArtProvider: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
mock.module("@/components/share/ShareSignIn", () => ({
  ShareSignIn: () => <div data-testid={"sign-in"} />,
}));
mock.module("@/components/track-audio/AudioCommentSection", () => ({
  useCommentThread: commentThreadStub,
  AudioCommentSection: ({
    trackAudioId,
    assetId,
  }: {
    trackAudioId: number;
    assetId: number;
  }) => (
    <div
      data-testid={"compose-section"}
      data-track-audio-id={trackAudioId}
      data-asset-id={assetId}
    />
  ),
}));

const { ShareComments } = await import("./ShareComments");
const { ShareRoomContext } = await import("./ShareRoom");

const PUBLIC_LINE =
  "Anyone with this link and the project's members can see comments.";
const PRIVATE_LINE =
  "Comments here are private: you see your own, and the project's members see all of them.";
const SIGN_IN_LEAD = "Sign in as a guest to leave a comment.";

const entry = {
  title: "First",
  trackAudioId: 7,
  assetId: 107,
} as unknown as ShareEntry;

const renderComments = (
  over: Partial<ShareRoom> = {},
  sharelink: Partial<Sharelink> = {}
) => {
  const room = {
    token: "tok",
    sharelink: { isCommentsPrivate: false, ...sharelink } as Sharelink,
    viewerId: null,
    entries: [entry],
    index: 0,
    entry,
    loaded: false,
    artwork: null,
    seek,
    thread: {
      comments: [],
      reload,
      registerScrollTarget: mock(),
    },
    ...over,
  } as unknown as ShareRoom;
  return render(
    <ShareRoomContext value={room}>
      <ShareComments />
    </ShareRoomContext>
  );
};

afterEach(cleanup);

describe("ShareComments", () => {
  it("says anyone with the link can see comments on a public share", () => {
    renderComments();

    expect(screen.getByText(PUBLIC_LINE)).toBeTruthy();
    expect(screen.queryByText(PRIVATE_LINE)).toBeNull();
  });

  it("says comments are private on a private share", () => {
    renderComments({}, { isCommentsPrivate: true });

    expect(screen.getByText(PRIVATE_LINE)).toBeTruthy();
    expect(screen.queryByText(PUBLIC_LINE)).toBeNull();
  });

  it("gives a signed-out reader the empty list and the sign-in card", () => {
    renderComments({ viewerId: null });

    expect(screen.getByText("No comments yet.")).toBeTruthy();
    expect(screen.getByText(SIGN_IN_LEAD)).toBeTruthy();
    expect(screen.getByTestId("sign-in")).toBeTruthy();
    expect(screen.queryByTestId("compose-section")).toBeNull();
  });

  it("shows a signed-out reader of a private share the private line and the card", () => {
    renderComments({ viewerId: null }, { isCommentsPrivate: true });

    expect(screen.getByText(PRIVATE_LINE)).toBeTruthy();
    expect(screen.getByText("No comments yet.")).toBeTruthy();
    expect(screen.getByTestId("sign-in")).toBeTruthy();
  });

  it("gives a reader with a session the compose section on the current entry", () => {
    renderComments({ viewerId: "user-1" });

    const section = screen.getByTestId("compose-section");
    expect(section.getAttribute("data-track-audio-id")).toBe("7");
    expect(section.getAttribute("data-asset-id")).toBe("107");
    expect(screen.queryByText(SIGN_IN_LEAD)).toBeNull();
    expect(screen.queryByTestId("sign-in")).toBeNull();
  });

  it("counts the thread beside the heading once it has comments", () => {
    renderComments({
      thread: {
        comments: [
          {
            id: 1,
            content: "Lovely",
            createdAt: new Date().toISOString(),
            positionMs: null,
            resolvedAt: null,
            viewerCan: { amend: false, resolve: false },
            replies: [],
          },
        ],
        reload,
        registerScrollTarget: mock(),
      },
    } as unknown as Partial<ShareRoom>);

    expect(screen.getByRole("heading", { name: "Comments , 1" })).toBeTruthy();
  });

  it("draws nothing when the share has no audio to comment on", () => {
    const { container } = renderComments({ entry: undefined, entries: [] });

    expect(container.textContent).toBe("");
  });
});
