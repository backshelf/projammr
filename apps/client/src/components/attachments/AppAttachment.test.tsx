import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { PoliciesProvider } from "@/lib/policies/provider";
import type { AttachedAsset } from "@workspace/api/api";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { afterEach, describe, expect, it, mock } from "bun:test";

const toastSuccess = mock();
const toastError = mock();
mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

const playerActions = { playNow: mock(), playNext: mock(), enqueue: mock() };
const playerActionsStub = () => playerActions;
mock.module("@/components/music-player/player-hooks", () => ({
  usePlayerActions: playerActionsStub,
}));

// Never settles, so a test can look at the tile mid-delete.
const deleteAsset = mock(() => new Promise(() => {}));
mock.module("@/actions/assets", () => ({ deleteAsset }));

let resolveLink: (value: unknown) => void = () => {};
const linkTrackAudios = mock(
  () =>
    new Promise((resolve) => {
      resolveLink = resolve;
    })
);
mock.module("@/actions/track-audios", () => ({ linkTrackAudios }));

const { AppAttachment } = await import("./AppAttachment");

const webUpload: AttachedAsset = {
  id: 42,
  createdAt: "2026-03-01T10:00:00.000Z",
  updatedAt: "2026-03-01T10:00:00.000Z",
  name: "take.wav",
  type: "audio/wav",
  size: 2048,
  assetPath: "./static/assets/take.wav",
  createdByUser: "u1",
  projectId: 1,
  localFilepath: null,
  localFileCreatedAt: null,
  localFileUpdatedAt: null,
  localFileMachineName: null,
  fingerprint: null,
  uploadedBy: { id: "u1", name: "Mira", image: null },
};

const localFile: AttachedAsset = {
  ...webUpload,
  name: "bounce.wav",
  localFilepath: "/Music/Bounces/bounce.wav",
  localFileCreatedAt: "2026-02-20T09:00:00.000Z",
  localFileUpdatedAt: "2026-02-21T09:00:00.000Z",
  localFileMachineName: "Studio Mac",
  fingerprint: `1024:${"ab".repeat(20)}`,
};

afterEach(() => {
  cleanup();
  for (const fn of [toastSuccess, toastError, deleteAsset, linkTrackAudios])
    fn.mockClear();
});

// Motion's features are what let an overlay's exit finish and unmount it.
const renderTile = (asset: AttachedAsset) =>
  render(<AppAttachment asset={asset} attachTo="track" parentId={7} />, {
    wrapper: MotionProvider,
  });

async function openMenu() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Options for/ }));
  });
}

async function chooseMenuItem(name: string | RegExp) {
  await openMenu();
  await act(async () => {
    fireEvent.click(await screen.findByRole("menuitem", { name }));
  });
}

describe("AppAttachment", () => {
  it("shows a local file's machine line and fingerprint mark", () => {
    const { container } = renderTile(localFile);

    expect(screen.getByText("RENDERED ON STUDIO MAC")).toBeDefined();
    expect(
      container.querySelector('[data-slot="fingerprint-mark"]')
    ).not.toBeNull();
  });

  it("shows a web upload's uploader line and no mark", () => {
    const { container } = renderTile(webUpload);

    expect(screen.getByText("UPLOADED BY MIRA")).toBeDefined();
    expect(
      container.querySelector('[data-slot="fingerprint-mark"]')
    ).toBeNull();
  });

  it("opens the details popover once the menu has closed", async () => {
    renderTile(localFile);

    await chooseMenuItem("Details");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copy path" })).toBeDefined()
    );
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the glance note on focus and closes it on Escape", async () => {
    renderTile(webUpload);
    const play = screen.getByRole("button", { name: "Play take.wav" });

    await act(async () => {
      fireEvent.focus(play);
    });
    // The tile's own line and the note's.
    expect(screen.getAllByText("UPLOADED BY MIRA")).toHaveLength(2);

    await act(async () => {
      fireEvent.keyDown(play, { key: "Escape" });
    });
    await waitFor(() =>
      expect(screen.getAllByText("UPLOADED BY MIRA")).toHaveLength(1)
    );
  });

  it("asks before deleting, and disables the menu while the file is being deleted", async () => {
    renderTile(webUpload);

    await chooseMenuItem("Delete");
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Delete take.wav?")).toBeDefined();
    expect(deleteAsset).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        within(confirm).getByRole("button", { name: "Delete file" })
      );
    });
    expect(deleteAsset).toHaveBeenCalledWith(42);
    // The confirm stays open until the delete settles, hiding the tile from
    // the accessibility tree behind it.
    expect(
      screen
        .getByRole("button", { name: "Options for take.wav", hidden: true })
        .hasAttribute("disabled")
    ).toBe(true);
  });

  it("keeps the file when the confirm is cancelled", async () => {
    renderTile(webUpload);

    await chooseMenuItem("Delete");
    const confirm = await screen.findByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    });

    expect(deleteAsset).not.toHaveBeenCalled();
  });

  it("deletes at once, unasked, when attachment confirms are off", async () => {
    render(<AppAttachment asset={webUpload} attachTo="track" parentId={7} />, {
      wrapper: ({ children }) => (
        <PoliciesProvider
          policies={{
            ...DEFAULT_POLICIES,
            feedback: {
              ...DEFAULT_POLICIES.feedback,
              confirmDeletes: {
                ...DEFAULT_POLICIES.feedback.confirmDeletes,
                attachment: false,
              },
            },
          }}
        >
          <MotionProvider>{children}</MotionProvider>
        </PoliciesProvider>
      ),
    });

    await chooseMenuItem("Delete");

    expect(deleteAsset).toHaveBeenCalledWith(42);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("leaves processing once the file is added as track audio", async () => {
    const { container } = renderTile(webUpload);

    await chooseMenuItem("Add as track audio");
    expect(linkTrackAudios).toHaveBeenCalledWith(7, [42]);
    expect(container.querySelector('[data-state="processing"]')).not.toBeNull();

    await act(async () => resolveLink([]));
    expect(toastSuccess).toHaveBeenCalledWith("Added as track audio");
    expect(container.querySelector('[data-state="processing"]')).toBeNull();
  });
});
