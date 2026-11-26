import { cleanup, render, screen } from "@testing-library/react";
import type { AttachedAsset } from "@workspace/api/api";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { afterEach, describe, expect, it, mock } from "bun:test";

const playerActionsStub = () => ({
  playNow: mock(),
  playNext: mock(),
  enqueue: mock(),
});
mock.module("@/components/music-player/player-hooks", () => ({
  usePlayerActions: playerActionsStub,
}));
mock.module("@/actions/assets", () => ({ deleteAsset: mock() }));
mock.module("@/actions/track-audios", () => ({ linkTrackAudios: mock() }));
mock.module("@/components/uploads/FileUploader", () => ({
  FileUploader: () => null,
}));

const { AttachmentList } = await import("./AttachmentList");

const asset = (id: number, name: string): AttachedAsset => ({
  id,
  createdAt: "2026-03-01T10:00:00.000Z",
  updatedAt: "2026-03-01T10:00:00.000Z",
  name,
  type: "audio/wav",
  size: 2048,
  assetPath: `./static/assets/${name}`,
  createdByUser: "u1",
  projectId: 1,
  localFilepath: null,
  localFileCreatedAt: null,
  localFileUpdatedAt: null,
  localFileMachineName: null,
  fingerprint: null,
  uploadedBy: { id: "u1", name: "Mira", image: null },
});

afterEach(cleanup);

describe("AttachmentList", () => {
  it("renders one tile per attached asset", () => {
    render(
      <AttachmentList
        attachments={[asset(1, "take.wav"), asset(2, "verse.wav")]}
        attachTo="track"
        parentId={7}
      />,
      { wrapper: MotionProvider }
    );

    const options = screen.getAllByRole("button", { name: /^Options for/ });
    expect(options.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Options for take.wav",
      "Options for verse.wav",
    ]);
  });
});
