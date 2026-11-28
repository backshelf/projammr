import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { customField } from "@/fields/custom-field-fixture";
import type { Status } from "@workspace/api/api";

const createTrack = mock(async () => ({ id: 1, title: "Track" }));
mock.module("@/actions/tracks", () => ({ createTrack }));

mock.module("@/components/product-linking/pickers", () => ({
  TrackPicker: () => null,
}));

const back = mock();
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(), back }),
}));

mock.module("sonner", () => ({
  toast: { success: mock(), error: mock() },
}));

// The block editor only mounts once hydrated; keeping it unhydrated in tests
// avoids pulling BlockNote's browser-only editor into happy-dom.
mock.module("@workspace/ui/hooks/use-hydrated", () => ({
  useHydrated: () => false,
}));

const { AddTrackMenu } = await import("./AddTrackMenu");

afterEach(() => {
  cleanup();
  createTrack.mockClear();
  back.mockClear();
});

const mixing: Status = {
  id: 7,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  name: "Mixing",
  percentage: 40,
  description: null,
  // eslint-disable-next-line no-restricted-syntax -- a status's own colourHex, not a class name
  colourHex: "#336699",
  projectId: null,
};

async function openNewTrackDialog() {
  await act(async () => {
    render(
      <AddTrackMenu
        projectId={1}
        collectionId={4}
        statusesPromise={Promise.resolve([mixing])}
        customFields={[customField(2, "Energy", "number")]}
      />
    );
  });
  const trigger = screen.getByRole("button", { name: "New track" });
  await act(async () => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitem", { name: "New track" }));
  });
}

describe("AddTrackMenu", () => {
  it("lists the project's track fields in the new-track dialog and sends their values", async () => {
    await openNewTrackDialog();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Neon Rain" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("— none —"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: /Mixing/ }));
    });
    fireEvent.change(screen.getByLabelText("Energy"), {
      target: { value: "7" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create track" }));
    });

    expect(createTrack).toHaveBeenCalledWith(
      expect.objectContaining({ collectionId: 4, fields: { cf_2: 7 } })
    );
  });

  it("closes the modal on Cancel instead of calling router.back()", async () => {
    await openNewTrackDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    expect(back).not.toHaveBeenCalled();
    expect(dialog.hasAttribute("data-closed")).toBe(true);
  });
});
