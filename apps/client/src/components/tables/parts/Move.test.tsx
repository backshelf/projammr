import type { PeekPanelProps } from "@/components/tables/PeekPanel";
import type { BulkSelection, MovePreview } from "@/entities/api";
import type { MoveReport } from "@workspace/api/api";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

// The peek row's own panel is not what the peek-close test is about; a
// stand-in that names the row it was given is enough, as `use-row-actions`'s
// suite does. `mock.module` is not hoisted, so the harness is imported after it.
mock.module("@/components/tables/PeekPanel", () => ({
  PeekPanel: (props: PeekPanelProps) => (
    <span data-testid="peek-title">{props.row?.title ?? "none"}</span>
  ),
}));

// The dialog loads its destination list when it opens; the network is not what
// most of these tests are about, so it resolves empty by default. A test that
// picks a destination calls `withOtherProject()`, undone in `afterEach` so
// later tests get the empty list again. `mock.module` is not hoisted, so the
// harness is imported after it.
const emptyProjects = async () => ({
  data: [] as { id: number; name: string }[],
  response: new Response("[]", { status: 200 }),
});
const projectsGet = mock(emptyProjects);
// Picking a destination asks what the move would drop; a test that wants some
// dropped values sets `previewAnswer`, reset in `afterEach`.
const NOTHING_DROPPED: MovePreview = { droppedFields: [] };
let previewAnswer: MovePreview = NOTHING_DROPPED;
const previewPost = mock<
  (path: string) => Promise<{ data: MovePreview; response: Response }>
>(async () => ({
  data: previewAnswer,
  response: new Response("{}", { status: 200 }),
}));
// A single row's move answers the row with the move's report merged onto it.
const movePost = mock(async () => ({
  data: {
    id: 1,
    priorityFallbacks: [{ from: "Urgent", to: "None", count: 1 }],
  },
  response: new Response("{}", { status: 200 }),
}));
mock.module("@/lib/browser-api", () => ({
  browserApi: {
    GET: projectsGet,
    POST: (path: string) =>
      path.endsWith("/move/preview") ? previewPost(path) : movePost(),
  },
}));
function withOtherProject() {
  projectsGet.mockImplementation(async () => ({
    data: [{ id: 2, name: "Other Project" }],
    response: new Response("[]", { status: 200 }),
  }));
}

const toastSuccess = mock();
const toastError = mock();
mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

afterEach(() => {
  projectsGet.mockImplementation(emptyProjects);
  previewAnswer = NOTHING_DROPPED;
  previewPost.mockClear();
  movePost.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
});

const { DATA, renderGrid, stateProbe } = await import("../test-support");

// A row's `⋯` menu offers "Move to project…" when the table can move rows. The
// dialog's code is a separate chunk, fetched the first time a row is moved.

const moveToProject = {
  kind: "track" as const,
  projectId: 1,
  hrefInProject: (_row: unknown, projectId: number) =>
    `/project/${projectId}/tracks`,
};
const rowActions = {
  label: (row: { title: string }) => row.title,
  copyHref: () => "/project/1/tracks/1",
};
const peek = {
  toPeekRow: (row: { id: number; title: string }) => row,
  href: (row: { id: number }) => `/track/${row.id}`,
  titleField: "title",
};

type BulkMove = (
  selection: BulkSelection,
  targetProjectId: number
) => Promise<{ ok: boolean; count?: number } & Partial<MoveReport>>;

/**
 * Opens the `⋯` menu of the nth row; Radix menus open on ArrowDown under
 * happy-dom. `label` is the table's `entityLabel` ("row" unless overridden),
 * since the button's own accessible name carries it.
 */
function openRowMenu(index: number, label = "row") {
  const trigger = screen.getAllByRole("button", {
    name: `More actions for ${label}`,
  })[index]!;
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
}

// `hidden: true` reaches the checkboxes even while an open dialog has put
// `aria-hidden` on the rest of the tree, which a plain role query respects.
const checkboxes = () =>
  screen.getAllByRole<HTMLInputElement>("checkbox", {
    name: "Select row",
    hidden: true,
  });
const checkedRows = () =>
  checkboxes()
    .map((box, index) => (box.checked ? index : -1))
    .filter((index) => index >= 0);
const selectRows = (...indexes: number[]) => {
  for (const index of indexes) fireEvent.click(checkboxes()[index]!);
};

/**
 * Picks the destination project once the dialog's select has loaded it, and
 * lets the check of what the move would drop answer.
 */
async function chooseDestination(name: string) {
  const trigger = await screen.findByRole("combobox", {
    name: "Destination project",
  });
  fireEvent.click(trigger);
  const item = await screen.findByText(name);
  fireEvent.pointerDown(item);
  await act(async () => {
    fireEvent.click(item);
  });
}

// A menu that has closed stays in the DOM under happy-dom (its exit animation
// never finishes), so the item of the menu opened last is the one to act on.
const moveItem = () =>
  screen.queryAllByRole("menuitem", { name: "Move to project…" }).at(-1) ??
  null;
const copyLinkItem = () =>
  screen.queryByRole("menuitem", { name: "Copy link" });

describe("the Move part", () => {
  it("renders no dialog until a row asks to move", () => {
    renderGrid(undefined, undefined, { rowActions, moveToProject });

    openRowMenu(0);

    expect(moveItem()).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the dialog for a row once its chunk resolves", async () => {
    renderGrid(undefined, undefined, { rowActions, moveToProject });

    openRowMenu(0);
    fireEvent.click(moveItem()!);

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Move One");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("says which priority level of the moved row fell back, from the server's report", async () => {
    withOtherProject();
    renderGrid(undefined, undefined, { rowActions, moveToProject });

    openRowMenu(0);
    fireEvent.click(moveItem()!);
    await chooseDestination("Other Project");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move" }));
    });

    expect(movePost).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith("Moved One", {
      description: "Urgent became None on 1 row.",
    });
  });

  it("clears the target on close, so the next Move opens for its own row", async () => {
    renderGrid(undefined, undefined, { rowActions, moveToProject });

    openRowMenu(0);
    fireEvent.click(moveItem()!);
    const first = await screen.findByRole("dialog");

    fireEvent.click(
      within(first).getAllByRole("button", { name: "Close" })[0]!
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    openRowMenu(1);
    fireEvent.click(moveItem()!);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Move Two");
  });

  it("offers no Move action on a table with no moveToProject", () => {
    renderGrid(undefined, undefined, { rowActions });

    openRowMenu(0);

    expect(copyLinkItem()).not.toBeNull();
    expect(moveItem()).toBeNull();
  });

  it("offers no Move action to a viewer", () => {
    renderGrid("viewer", undefined, { rowActions, moveToProject });

    openRowMenu(0);

    expect(copyLinkItem()).not.toBeNull();
    expect(moveItem()).toBeNull();
  });
});

const RULES: Record<string, string> = {
  track: "Sessions and audio only these tracks use move with them.",
  collection:
    "Tracks only in this collection move; shared tracks stay and leave the collection.",
  session: "Track links are cleared; attachments only these sessions use move.",
};

describe("the Move part for a selection", () => {
  it("offers no Move action inside a selection when the table cannot bulk-move", () => {
    renderGrid(undefined, undefined, {
      rowActions,
      moveToProject,
      enableSelection: true,
    });
    selectRows(0, 1);

    openRowMenu(0);

    expect(moveItem()).toBeNull();
  });

  it.each(["track", "collection", "session"] as const)(
    "confirms a %s selection with its count and kind's rule",
    async (kind) => {
      const onBulkMove = mock<BulkMove>(async () => ({ ok: true, count: 2 }));
      renderGrid(undefined, undefined, {
        rowActions,
        moveToProject: { ...moveToProject, kind },
        entityLabel: "track",
        enableSelection: true,
        onBulkMove,
      });
      selectRows(0, 1);

      openRowMenu(0, "track");
      fireEvent.click(moveItem()!);

      const dialog = await screen.findByRole("dialog");
      expect(dialog.textContent).toContain("Move 2 tracks");
      expect(dialog.textContent).toContain(RULES[kind]!);
    }
  );

  it("calls onBulkMove with the selection, toasts the count and clears it on success", async () => {
    withOtherProject();
    const onBulkMove = mock<BulkMove>(async () => ({ ok: true, count: 2 }));
    renderGrid(undefined, undefined, {
      rowActions,
      moveToProject,
      entityLabel: "track",
      enableSelection: true,
      onBulkMove,
    });
    selectRows(0, 1);
    openRowMenu(0, "track");
    fireEvent.click(moveItem()!);

    await chooseDestination("Other Project");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move" }));
    });

    expect(onBulkMove).toHaveBeenCalledWith(
      { ids: [DATA[0]!.id, DATA[1]!.id] },
      2
    );
    expect(toastSuccess).toHaveBeenCalledWith("Moved 2 tracks", {
      description: undefined,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(checkedRows()).toEqual([]);
  });

  it("says which priority levels fell back to the destination's default", async () => {
    withOtherProject();
    const onBulkMove = mock<BulkMove>(async () => ({
      ok: true,
      count: 2,
      priorityFallbacks: [{ from: "High", to: "None", count: 2 }],
    }));
    renderGrid(undefined, undefined, {
      rowActions,
      moveToProject,
      entityLabel: "track",
      enableSelection: true,
      onBulkMove,
    });
    selectRows(0, 1);
    openRowMenu(0, "track");
    fireEvent.click(moveItem()!);

    await chooseDestination("Other Project");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move" }));
    });

    expect(toastSuccess).toHaveBeenCalledWith("Moved 2 tracks", {
      description: "High became None on 2 rows.",
    });
  });

  it("toasts an error and keeps the selection when onBulkMove fails", async () => {
    withOtherProject();
    const onBulkMove = mock<BulkMove>(async () => ({ ok: false }));
    renderGrid(undefined, undefined, {
      rowActions,
      moveToProject,
      enableSelection: true,
      onBulkMove,
    });
    selectRows(0, 1);
    openRowMenu(0);
    fireEvent.click(moveItem()!);

    await chooseDestination("Other Project");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move" }));
    });

    expect(toastError).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(checkedRows()).toEqual([0, 1]);
  });

  it("closes the peek when the peeked row was among the moved ids", async () => {
    withOtherProject();
    const onBulkMove = mock<BulkMove>(async () => ({ ok: true, count: 2 }));
    const probe = stateProbe();
    renderGrid(undefined, undefined, {
      rowActions,
      moveToProject,
      enableSelection: true,
      onBulkMove,
      peek,
      children: <probe.Probe />,
    });
    selectRows(0, 1);
    fireEvent.click(screen.getAllByRole("button", { name: "Open row" })[0]!);
    expect(probe.state().peekId).toBe(DATA[0]!.id);

    openRowMenu(0);
    fireEvent.click(moveItem()!);
    await chooseDestination("Other Project");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move" }));
    });

    await waitFor(() => expect(probe.state().peekId).toBeNull());
  });
});

describe("the move dialog's check of what a move drops", () => {
  const DROPPED: MovePreview = {
    droppedFields: [
      { fieldId: 1, kind: "track", name: "Mood", type: "select", count: 3 },
      { fieldId: 5, kind: "track", name: "Stems", type: "url", count: 1 },
    ],
  };

  it("lists each custom field a row's move drops, with how many values, before the move", async () => {
    withOtherProject();
    previewAnswer = DROPPED;
    renderGrid(undefined, undefined, { rowActions, moveToProject });
    openRowMenu(0);
    fireEvent.click(moveItem()!);

    await chooseDestination("Other Project");

    expect(previewPost).toHaveBeenCalledWith("/api/tracks/{id}/move/preview");
    const note = screen.getByText(
      "These field values will be dropped"
    ).parentElement!;
    expect(within(note).getByText("Mood")).toBeTruthy();
    expect(within(note).getByText("3 values")).toBeTruthy();
    expect(within(note).getByText("1 value")).toBeTruthy();
    expect(note.textContent).toContain("Other Project has no field");
    expect(movePost).not.toHaveBeenCalled();
  });

  it("asks for a selection's move through the bulk preview", async () => {
    withOtherProject();
    previewAnswer = DROPPED;
    renderGrid(undefined, undefined, {
      rowActions,
      moveToProject,
      entityLabel: "track",
      enableSelection: true,
      onBulkMove: mock<BulkMove>(async () => ({ ok: true, count: 2 })),
    });
    selectRows(0, 1);
    openRowMenu(0, "track");
    fireEvent.click(moveItem()!);

    await chooseDestination("Other Project");

    expect(previewPost).toHaveBeenCalledWith("/api/tracks/bulk/move/preview");
    expect(screen.getByText("These field values will be dropped")).toBeTruthy();
  });

  it("lists nothing when every value carries over", async () => {
    withOtherProject();
    renderGrid(undefined, undefined, { rowActions, moveToProject });
    openRowMenu(0);
    fireEvent.click(moveItem()!);

    await chooseDestination("Other Project");

    expect(previewPost).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("These field values will be dropped")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Move" }).hasAttribute("disabled")
    ).toBe(false);
  });
});
