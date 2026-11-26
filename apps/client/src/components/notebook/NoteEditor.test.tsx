import { CommandRegistry } from "@/components/commands/provider";
import { NOTEBOOK_COMMANDS } from "@/components/commands/notebook";
import type { ActionContext } from "@/components/commands/types";
import { act, cleanup, render } from "@testing-library/react";
import type { NoteDetail } from "@workspace/api/api";
import { afterEach, describe, expect, it, mock } from "bun:test";

const copyNoteText = mock(async () => {});
const linkDialogOpen = mock();

mock.module("next/navigation", () => ({
  usePathname: () => "/notes/7",
  useRouter: () => ({ push: mock(), refresh: mock() }),
}));
mock.module("next/dynamic", () => ({ default: () => () => null }));
mock.module("@/actions/notes", () => ({
  deleteNote: mock(),
  unlinkNote: mock(),
}));
mock.module("@/components/notebook/copy-note-text", () => ({ copyNoteText }));
mock.module("@/components/notebook/LinkNoteDialog", () => ({
  LinkNoteDialog: ({ open }: { open: boolean }) => {
    linkDialogOpen(open);
    return null;
  },
}));
mock.module("@/components/notebook/NotebookShell", () => ({
  useNotebook: () => null,
}));
mock.module("@/components/navigation/AppLink", () => ({
  AppLink: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));
mock.module("@/lib/notes-client", () => ({
  createNoteClient: mock(),
  saveNoteClient: mock(),
}));
mock.module("@/lib/settings/provider", () => ({
  useSetting: () => "plain",
}));
mock.module("@/components/theme/AppThemeProvider", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));
mock.module("sonner", () => ({ toast: { success: mock(), error: mock() } }));

const { NoteEditor } = await import("./NoteEditor");

function detail(can: Partial<NoteDetail["can"]> = {}): NoteDetail {
  return {
    id: 7,
    version: 1,
    title: "Verse",
    pinned: false,
    lyricsMode: false,
    body: [{ type: "paragraph" }],
    can: { write: true, unlink: false, delete: true, ...can },
  } as unknown as NoteDetail;
}

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  });
}

function renderEditor(surface: "notebook" | "track", note = detail()) {
  return render(
    <CommandRegistry
      commands={NOTEBOOK_COMMANDS}
      context={{} as unknown as ActionContext}
    >
      <NoteEditor
        surface={surface}
        note={note}
        layout={({ editor }) => <div>{editor}</div>}
      />
    </CommandRegistry>
  );
}

afterEach(() => {
  cleanup();
  copyNoteText.mockClear();
  linkDialogOpen.mockClear();
});

describe("NoteEditor keys", () => {
  it("copies the note's text on y on the notebook surface", () => {
    renderEditor("notebook");

    press("y");
    expect(copyNoteText).toHaveBeenCalledWith(7);
  });

  it("opens the link dialog on t on the notebook surface", () => {
    renderEditor("notebook");

    press("t");
    expect(linkDialogOpen).toHaveBeenLastCalledWith(true);
  });

  it("pushes no note keys on a track page", () => {
    renderEditor("track");

    press("y");
    press("t");
    expect(copyNoteText).not.toHaveBeenCalled();
    expect(linkDialogOpen).not.toHaveBeenCalledWith(true);
  });

  it("leaves t unavailable to a note that is not the caller's", () => {
    renderEditor("notebook", detail({ delete: false }));

    press("t");
    expect(linkDialogOpen).not.toHaveBeenCalledWith(true);
  });

  it("leaves t unavailable to a note already linked to a track", () => {
    renderEditor("notebook", detail({ unlink: true }));

    press("t");
    expect(linkDialogOpen).not.toHaveBeenCalledWith(true);
  });
});
