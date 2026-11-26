import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const toastError = mock();
mock.module("sonner", () => ({
  toast: { success: mock(), error: toastError },
}));

const attachAssetTo = mock();
const deleteAsset = mock();
mock.module("@/actions/assets", () => ({ attachAssetTo, deleteAsset }));
mock.module("@/actions/track-audios", () => ({ linkTrackAudios: mock() }));
mock.module("@/components/music-player/player-hooks", () => ({
  usePlayerActions: () => ({
    playNow: mock(),
    playNext: mock(),
    enqueue: mock(),
  }),
}));
mock.module("@/components/deep-link/use-deep-link", () => ({
  useDeepLink: () => ({
    open: mock(),
    fallbackOpen: false,
    setFallbackOpen: () => {},
  }),
}));

const uploadAsset = mock();
const uploadLimit = mock();
mock.module("@/components/uploads/upload-client", () => ({
  uploadAsset,
  uploadImage: mock(),
  uploadLimit,
  tooBigMaximum: () => null,
}));

const refresh = mock();
mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh, push: mock(), replace: mock() }),
  useParams: () => ({}),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("@/hooks/use-project-role", () => ({
  useProject: () => ({ id: 7 }),
  useProjectRole: () => ({}),
}));

const { FileUploader } = await import("./FileUploader");

/** Drives one file into the drop zone's input and waits for the row to show. */
async function drop(props: Parameters<typeof FileUploader>[0]) {
  const view = render(
    <MotionProvider>
      <FileUploader {...props} />
    </MotionProvider>
  );
  const input =
    view.container.querySelector<HTMLInputElement>("input[type=file]")!;
  const file = new File(["x"], "take.wav", { type: "audio/wav" });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(uploadAsset).toHaveBeenCalled());
  return view;
}

beforeEach(() => {
  uploadAsset.mockResolvedValue({ id: 5, name: "take.wav" });
  attachAssetTo.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  for (const fn of [
    toastError,
    attachAssetTo,
    uploadAsset,
    uploadLimit,
    refresh,
  ]) {
    fn.mockReset();
  }
});

describe("FileUploader hint", () => {
  const renderUploader = () =>
    render(
      <MotionProvider>
        <FileUploader />
      </MotionProvider>
    );

  it("prints the upload limit the server serves", async () => {
    uploadLimit.mockResolvedValue(40 * 1024 * 1024);
    const view = renderUploader();
    await waitFor(() =>
      expect(view.getByText("Up to 40 MB per file")).not.toBeNull()
    );
  });

  it("prints no limit when the server could not say", async () => {
    uploadLimit.mockResolvedValue({ error: "You are not signed in" });
    const view = renderUploader();
    await waitFor(() => expect(uploadLimit).toHaveBeenCalled());
    expect(view.queryByText(/per file/)).toBeNull();
  });
});

describe("FileUploader attach", () => {
  it.each(["project", "collection", "track", "session"] as const)(
    "attaches an uploaded file to a %s through attachAssetTo",
    async (attachTo) => {
      await drop({ attachTo, parentId: 3 });
      await waitFor(() =>
        expect(attachAssetTo).toHaveBeenCalledWith(5, attachTo, 3)
      );
      expect(refresh).not.toHaveBeenCalled();
    }
  );

  it("refreshes once and attaches nothing when there is no attachTo", async () => {
    await drop({});
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(attachAssetTo).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("marks the row as an error and toasts when the attach fails", async () => {
    attachAssetTo.mockResolvedValue({ error: "nope" });
    const view = await drop({ attachTo: "project", parentId: 3 });
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Failed to attach: nope")
    );
    await waitFor(() =>
      expect(view.container.querySelector("[data-state=error]")).not.toBeNull()
    );
  });

  it("marks the row as an error when the upload fails", async () => {
    uploadAsset.mockResolvedValue({ error: "too big" });
    const view = await drop({ attachTo: "project", parentId: 3 });
    await waitFor(() =>
      expect(view.container.querySelector("[data-state=error]")).not.toBeNull()
    );
    expect(attachAssetTo).not.toHaveBeenCalled();
  });
});
