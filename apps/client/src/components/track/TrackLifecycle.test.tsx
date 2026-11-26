import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { ENTITY_COMMANDS } from "@/components/commands/entity";
import { EntitySurfaceProvider } from "@/components/commands/entity-surface";
import { CommandRegistry } from "@/components/commands/provider";
import type { ActionContext } from "@/components/commands/types";
import { DEFAULT_FEEDBACK } from "@/lib/policies/shell";

type ArchiveInput = {
  projectId: number;
  selection: { ids: number[] };
  title?: string;
  router: unknown;
};

const archiveResult = { ok: true as const, message: "Archived Demo" };
type ArchiveCommand = (input: ArchiveInput) => Promise<typeof archiveResult>;
const archiveTracks = mock<ArchiveCommand>(async () => archiveResult);
const unarchiveTracks = mock<ArchiveCommand>(async () => archiveResult);
mock.module("@/entities/track/archive", () => ({
  archiveTracks,
  unarchiveTracks,
}));

const toastActionResult = mock();
mock.module("@/lib/action-toast", () => ({ toastActionResult }));

let deleteAnswer: "ok" | "fail" = "ok";
const deletePaths: unknown[] = [];
mock.module("@/lib/browser-api", () => ({
  browserApi: {
    DELETE: (path: string, init: unknown) => {
      deletePaths.push({ path, init });
      return Promise.resolve(
        deleteAnswer === "ok"
          ? { response: new Response(null, { status: 204 }) }
          : {
              error: { error: "Nope" },
              response: new Response(JSON.stringify({ error: "Nope" }), {
                status: 500,
                headers: { "content-type": "application/json" },
              }),
            }
      );
    },
  },
}));

const push = mock();
const refresh = mock();
const router = { push, refresh };
mock.module("next/navigation", () => ({
  useRouter: () => router,
}));

const toastSuccess = mock();
const toastError = mock();
mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

const { TrackRailActions, UnarchiveAction } = await import("./TrackLifecycle");

const track = { projectId: 7, trackId: 42, title: "Demo" };

afterEach(() => {
  cleanup();
  for (const fn of [
    archiveTracks,
    unarchiveTracks,
    toastActionResult,
    push,
    refresh,
    toastSuccess,
    toastError,
  ]) {
    fn.mockClear();
  }
  deletePaths.length = 0;
  deleteAnswer = "ok";
});

const actionNames = () =>
  screen.getAllByRole("button").map((button) => button.textContent);

async function confirmDelete() {
  fireEvent.click(screen.getByRole("button", { name: "Delete track" }));
  const confirm = await screen.findByRole("button", { name: "Delete" });
  await act(async () => {
    fireEvent.click(confirm);
  });
}

describe("TrackRailActions", () => {
  it("offers Archive then Delete on a live track", () => {
    render(<TrackRailActions {...track} archived={false} />);

    expect(actionNames()).toEqual(["Archive track", "Delete track"]);
  });

  it("offers Delete alone on an archived track", () => {
    render(<TrackRailActions {...track} archived />);

    expect(actionNames()).toEqual(["Delete track"]);
  });

  it("archives the one track by id, naming it, and toasts the result", async () => {
    render(<TrackRailActions {...track} archived={false} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive track" }));
    });

    expect(archiveTracks).toHaveBeenCalledTimes(1);
    const input = archiveTracks.mock.calls[0]![0];
    expect(input.projectId).toBe(7);
    expect(input.selection).toEqual({ ids: [42] });
    expect(input.title).toBe("Demo");
    expect(input.router).toBe(router);
    expect(toastActionResult).toHaveBeenCalledWith(
      archiveResult,
      DEFAULT_FEEDBACK.undoWindowMs
    );
  });

  it("confirms before deleting, then lands on the tracks list without refreshing the deleted page", async () => {
    render(<TrackRailActions {...track} archived={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete track" }));
    expect(await screen.findByText("Delete Demo?")).toBeTruthy();
    expect(deletePaths).toHaveLength(0);

    const confirm = screen.getByRole("button", { name: "Delete" });
    await act(async () => {
      fireEvent.click(confirm);
    });

    expect(deletePaths).toEqual([
      { path: "/api/tracks/{id}", init: { params: { path: { id: "42" } } } },
    ]);
    expect(toastSuccess).toHaveBeenCalledWith("Deleted Demo");
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/project/7/track/all");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stays on the page with an error toast when the delete fails", async () => {
    deleteAnswer = "fail";
    render(<TrackRailActions {...track} archived={false} />);

    await confirmDelete();

    expect(toastError).toHaveBeenCalledWith("Could not delete Demo: Nope");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("the delete key", () => {
  const CONTEXT = { router } as unknown as ActionContext;

  function onTrackPage() {
    return render(
      <CommandRegistry commands={ENTITY_COMMANDS} context={CONTEXT}>
        <EntitySurfaceProvider previousHref={null} nextHref={null}>
          <TrackRailActions {...track} archived={false} />
        </EntitySurfaceProvider>
      </CommandRegistry>
    );
  }

  function pressDelete() {
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Backspace",
          metaKey: true,
          ctrlKey: true,
        })
      );
    });
  }

  it("asks the delete gate's confirm before deleting anything", async () => {
    onTrackPage();

    pressDelete();

    expect(await screen.findByText("Delete Demo?")).toBeTruthy();
    expect(deletePaths).toHaveLength(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    });
    expect(deletePaths).toHaveLength(1);
    expect(push).toHaveBeenCalledWith("/project/7/track/all");
  });

  it("does nothing on a page without the entity provider", () => {
    render(
      <CommandRegistry commands={ENTITY_COMMANDS} context={CONTEXT}>
        <TrackRailActions {...track} archived={false} />
      </CommandRegistry>
    );

    pressDelete();

    expect(screen.queryByText("Delete Demo?")).toBeNull();
    expect(deletePaths).toHaveLength(0);
  });
});

describe("UnarchiveAction", () => {
  it("unarchives the one track by id, naming it", async () => {
    render(<UnarchiveAction {...track} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
    });

    const input = unarchiveTracks.mock.calls[0]![0];
    expect(input.selection).toEqual({ ids: [42] });
    expect(input.title).toBe("Demo");
    expect(toastActionResult).toHaveBeenCalledWith(
      archiveResult,
      DEFAULT_FEEDBACK.undoWindowMs
    );
  });
});
