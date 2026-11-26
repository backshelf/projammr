import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { PoliciesProvider } from "@/lib/policies/provider";
import type { CandidateAudio } from "@workspace/api/api";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ReactNode } from "react";

mock.module("sonner", () => ({ toast: { success: mock(), error: mock() } }));

const deleteAsset = mock(async () => ({ ok: true }));
mock.module("@/actions/assets", () => ({
  attachAssetTo: mock(),
  deleteAsset,
}));

const candidate = {
  id: 42,
  name: "bounce.wav",
  size: 2048,
  createdAt: "2026-03-01T10:00:00.000Z",
  localFileCreatedAt: null,
  trackAudio: { id: 5, version: 2 },
} as unknown as CandidateAudio;

const getCandidateAudios = mock(async () => [candidate]);
mock.module("@/actions/track-audios", () => ({
  getCandidateAudios,
  linkTrackAudios: mock(),
  unlinkTrackAudio: mock(),
}));

mock.module("@/components/uploads/FileUploader", () => ({
  FileUploader: () => null,
}));

const { TrackAudioDialog } = await import("./TrackAudioDialog");

afterEach(() => {
  cleanup();
  deleteAsset.mockClear();
  getCandidateAudios.mockClear();
});

const withAudioVersionConfirm =
  (confirm: boolean) =>
  ({ children }: { children: ReactNode }) => (
    <PoliciesProvider
      policies={{
        ...DEFAULT_POLICIES,
        feedback: {
          ...DEFAULT_POLICIES.feedback,
          confirmDeletes: {
            ...DEFAULT_POLICIES.feedback.confirmDeletes,
            audioVersion: confirm,
          },
        },
      }}
    >
      {children}
    </PoliciesProvider>
  );

async function renderDialog(confirm = true) {
  await act(async () => {
    render(<TrackAudioDialog trackId={7} open onOpenChange={() => {}} />, {
      wrapper: withAudioVersionConfirm(confirm),
    });
  });
}

describe("TrackAudioDialog delete", () => {
  it("asks before deleting an audio file, naming the version that goes", async () => {
    await renderDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete bounce.wav" })
    );

    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Delete bounce.wav?")).toBeTruthy();
    expect(
      within(confirm).getByText(
        "The file comes off everything it is attached to, and version 2 of this track goes with it."
      )
    ).toBeTruthy();
    expect(deleteAsset).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        within(confirm).getByRole("button", { name: "Delete file" })
      );
    });

    expect(deleteAsset).toHaveBeenCalledWith(42);
  });

  it("keeps the file when the confirm is cancelled", async () => {
    await renderDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete bounce.wav" })
    );
    const confirm = await screen.findByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    });

    expect(deleteAsset).not.toHaveBeenCalled();
    // Cancelling the confirm leaves the dialog it sits in open.
    expect(screen.getByText("Track audios")).toBeTruthy();
  });

  it("deletes at once, unasked, when audio version confirms are off", async () => {
    await renderDialog(false);

    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: "Delete bounce.wav" })
      );
    });

    expect(deleteAsset).toHaveBeenCalledWith(42);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
