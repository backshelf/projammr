import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { AssetWithContext } from "@workspace/api/api";
import { effectiveSettings } from "@/lib/settings/effective";
import { SettingsProvider } from "@/lib/settings/provider";
import { MotionProvider } from "@workspace/ui/components/motion-provider";

const playNow = mock();
const playNext = mock();
const enqueue = mock();
mock.module("@/components/music-player/player-hooks", () => ({
  usePlayerActions: () => ({ playNow, playNext, enqueue }),
}));

mock.module("@/components/uploads/DownloadAssetDialog", () => ({
  DownloadAssetDialog: () => null,
}));

const { AssetRowActions } = await import("./AssetRowActions");
const { RowDeleteContext } = await import("./row-delete");

const localFile = {
  id: 42,
  name: "bounce.wav",
  assetPath: "42/bounce.wav",
  createdAt: "2026-03-01T10:00:00.000Z",
  localFilepath: "/Music/Bounces/bounce.wav",
  localFileCreatedAt: "2026-02-20T09:00:00.000Z",
  localFileUpdatedAt: "2026-02-21T09:00:00.000Z",
  localFileMachineName: "Studio Mac",
  fingerprint: null,
  uploadedBy: null,
} as unknown as AssetWithContext;

const webUpload = {
  ...localFile,
  id: 43,
  name: "notes.txt",
  localFilepath: null,
  localFileCreatedAt: null,
  localFileUpdatedAt: null,
  localFileMachineName: null,
  uploadedBy: { id: "u1", name: "Mira", image: null },
} as unknown as AssetWithContext;

afterEach(() => {
  cleanup();
  for (const fn of [playNow, playNext, enqueue]) fn.mockClear();
});

async function openMenu(
  asset: AssetWithContext,
  requestDelete: ReturnType<typeof mock> | null = mock()
) {
  render(
    <RowDeleteContext value={requestDelete}>
      <AssetRowActions asset={asset} projectId={1} />
    </RowDeleteContext>,
    { wrapper: MotionProvider }
  );
  const trigger = screen.getByRole("button", {
    name: `Options for ${asset.name}`,
  });
  await act(async () => {
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    fireEvent.mouseDown(trigger, { button: 0 });
    fireEvent.mouseUp(trigger, { button: 0 });
    fireEvent.click(trigger, { button: 0 });
  });
  await screen.findByRole("menu");
  return { requestDelete, trigger };
}

describe("AssetRowActions", () => {
  it("offers Details for every file, after Download", async () => {
    await openMenu(webUpload);
    const items = screen.getAllByRole("menuitem").map((el) => el.textContent);
    expect(items.slice(0, 2)).toEqual(["Download", "Details"]);
  });

  it("opens the provenance popover with the file's path from Details", async () => {
    await openMenu(localFile);
    fireEvent.click(screen.getByRole("menuitem", { name: "Details" }));
    await waitFor(() =>
      expect(screen.getByText("/Music/Bounces/bounce.wav")).toBeTruthy()
    );
  });

  it("keeps the popover open after the menu's close settles", async () => {
    await openMenu(localFile);
    fireEvent.click(screen.getByRole("menuitem", { name: "Details" }));
    await screen.findByRole("button", { name: "Copy path" });
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(screen.getByRole("button", { name: "Copy path" })).toBeTruthy();
  });

  it("keeps Play, Play next and Add to queue for an audio file", async () => {
    await openMenu(localFile);
    fireEvent.click(screen.getByRole("menuitem", { name: "Play next" }));
    expect(playNext).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Play bounce.wav" })
    ).toBeTruthy();
  });

  it("leaves the audio items and the Play button off a non-audio file", async () => {
    await openMenu(webUpload);
    expect(screen.queryByRole("menuitem", { name: "Play next" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Play notes.txt" })).toBeNull();
  });

  it("offers Delete file when the table can delete, and asks it to", async () => {
    const { requestDelete } = await openMenu(localFile);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete file" }));
    expect(requestDelete).toHaveBeenCalledWith([42], '"bounce.wav"');
  });

  it("drops Delete file when the table has no delete", async () => {
    await openMenu(localFile, null);
    expect(screen.queryByRole("menuitem", { name: "Delete file" })).toBeNull();
  });

  it("hides the play control until hover by default", () => {
    const { container } = render(
      <RowDeleteContext value={mock()}>
        <AssetRowActions asset={localFile} projectId={1} />
      </RowDeleteContext>,
      { wrapper: MotionProvider }
    );
    const wrapper = container.querySelector('[class*="group/play"]');
    expect(wrapper?.className).toContain("fine:opacity-0");
  });

  it("shows the play control at rest when tables.hoverPlay is always", () => {
    const { container } = render(
      <SettingsProvider
        initial={effectiveSettings({ "tables.hoverPlay": "always" }, "test")}
      >
        <RowDeleteContext value={mock()}>
          <AssetRowActions asset={localFile} projectId={1} />
        </RowDeleteContext>
      </SettingsProvider>,
      { wrapper: MotionProvider }
    );
    const wrapper = container.querySelector('[class*="group/play"]');
    expect(wrapper?.className).toContain("opacity-100");
    expect(wrapper?.className).not.toContain("fine:opacity-0");
  });
});
