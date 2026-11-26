import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { DuplicateAudio, MemberRole } from "@workspace/api/api";

const refresh = mock();
mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const toastSuccess = mock();
const toastError = mock();
mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

const getDuplicateAudio = mock(
  async (): Promise<DuplicateAudio | { error: string }> => ({ groups: [] })
);
mock.module("@/lib/asset-queries", () => ({ getDuplicateAudio }));

const { defineMutation } = await import("@/lib/mutation");
const removeDuplicateAudio = mock((_projectId: number, ids: number[]) =>
  defineMutation(async () => ({ deleted: ids.length }), ["route"])
);
mock.module("@/lib/asset-mutations", () => ({ removeDuplicateAudio }));

const { ProjectProvider } = await import("@/hooks/use-project-role");
const { DuplicateAudioAudit } = await import("./DuplicateAudioAudit");

afterEach(() => {
  cleanup();
  for (const fn of [
    refresh,
    toastSuccess,
    toastError,
    getDuplicateAudio,
    removeDuplicateAudio,
  ]) {
    fn.mockClear();
  }
});

const MB = 1024 * 1024;

const audit: DuplicateAudio = {
  groups: [
    {
      kept: { id: 1, name: "Song.wav", size: 48 * MB },
      remove: [
        { id: 2, name: "Song.mp3", size: 9 * MB },
        { id: 3, name: "Song.flac", size: 30 * MB },
      ],
      skipped: [],
    },
    {
      kept: { id: 4, name: "Other.wav", size: 40 * MB },
      remove: [],
      skipped: [
        { id: 5, name: "Other.mp3", size: 7 * MB, reason: "in-use" },
        { id: 6, name: "Other.aiff", size: 20 * MB, reason: "commented" },
      ],
    },
  ],
};

async function renderAudit(role: MemberRole = "editor") {
  render(
    <ProjectProvider project={{ id: 1, name: "Project", role }}>
      <DuplicateAudioAudit projectId={1} />
    </ProjectProvider>
  );
}

async function openAudit() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Find duplicates" }));
  });
}

describe("DuplicateAudioAudit", () => {
  it("lists each group's kept, removed and skipped files with sizes and reasons", async () => {
    getDuplicateAudio.mockResolvedValueOnce(audit);
    await renderAudit();
    await openAudit();

    const dialog = screen.getByRole("alertdialog");
    for (const name of [
      "Song.wav",
      "Song.mp3",
      "Song.flac",
      "Other.wav",
      "Other.mp3",
      "Other.aiff",
    ]) {
      expect(dialog.textContent).toContain(name);
    }
    for (const size of ["48 MB", "9 MB", "30 MB", "40 MB", "7 MB", "20 MB"]) {
      expect(dialog.textContent).toContain(size);
    }
    expect(dialog.textContent).toContain("Used where the kept file isn't");
    expect(dialog.textContent).toContain("Has comments");
    expect(screen.getByRole("button", { name: "Remove 2 files" })).toBeTruthy();
  });

  it("sends exactly the listed remove ids when confirmed, then reports what the server deleted", async () => {
    getDuplicateAudio.mockResolvedValueOnce(audit);
    await renderAudit();
    await openAudit();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove 2 files" }));
    });

    expect(removeDuplicateAudio).toHaveBeenCalledTimes(1);
    expect(removeDuplicateAudio).toHaveBeenCalledWith(1, [2, 3]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith("Removed 2 duplicate files");
  });

  it("sends more than 500 ids in batches of 500 and reports the server's total", async () => {
    const remove = Array.from({ length: 1001 }, (_, i) => ({
      id: i + 10,
      name: `Song-${i}.mp3`,
      size: MB,
    }));
    getDuplicateAudio.mockResolvedValueOnce({
      groups: [
        {
          kept: { id: 1, name: "Song.wav", size: 50 * MB },
          remove,
          skipped: [],
        },
      ],
    });
    removeDuplicateAudio.mockImplementation((_projectId, ids) =>
      defineMutation(async () => ({ deleted: ids.length - 1 }), ["route"])
    );
    await renderAudit();
    await openAudit();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Remove 1001 files" })
      );
    });

    expect(
      removeDuplicateAudio.mock.calls.map(([, ids]) => ids.length)
    ).toEqual([500, 500, 1]);
    expect(toastSuccess).toHaveBeenCalledWith("Removed 998 duplicate files");
  });

  it("shows the empty state, and skipped files, with no destructive button", async () => {
    getDuplicateAudio.mockResolvedValueOnce({
      groups: [{ ...audit.groups[1]! }],
    });
    await renderAudit();
    await openAudit();

    expect(screen.getByText("No duplicate audio found.")).toBeTruthy();
    expect(screen.getByText("Other.mp3")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
  });

  it("shows the error with a retry and no destructive button when the audit fails", async () => {
    getDuplicateAudio.mockResolvedValueOnce({ error: "Boom" });
    await renderAudit();
    await openAudit();

    expect(screen.getByRole("alert").textContent).toContain("Boom");
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();

    getDuplicateAudio.mockResolvedValueOnce(audit);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });

    expect(getDuplicateAudio).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Remove 2 files" })).toBeTruthy();
  });

  it("renders no button for a viewer", async () => {
    await renderAudit("viewer");

    expect(
      screen.queryByRole("button", { name: "Find duplicates" })
    ).toBeNull();
  });
});
