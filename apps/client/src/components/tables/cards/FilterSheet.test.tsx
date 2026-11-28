import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

import { ProjectProvider } from "@/hooks/use-project-role";
import type { MemberRole, SavedView } from "@workspace/api/api";
import { MotionProvider } from "@workspace/ui/components/motion-provider";

import type { SavedViewsConfig } from "../generic-table-types";
import { FilterSheet, type FilterSheetProps } from "./FilterSheet";

afterEach(cleanup);

const ownView: SavedView = {
  id: 7,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  projectId: 1,
  ownerId: "user-1",
  shared: false,
  owner: { id: "user-1", name: "Owner" },
  name: "Mine",
  kind: "track",
  config: { query: "q=Mine" },
};

const othersView: SavedView = {
  ...ownView,
  id: 9,
  ownerId: "user-2",
  shared: true,
  owner: { id: "user-2", name: "Alex" },
  name: "Alex's View",
  config: { query: "q=Alex" },
};

function viewsConfig(views: SavedView[]): SavedViewsConfig {
  return {
    views,
    me: "user-1",
    onSave: mock(async () => true),
    onDelete: mock(async () => true),
    onShare: mock(async () => true),
    defaultViewId: null,
    onSetDefault: mock(async () => true),
    onClearDefault: mock(async () => true),
  };
}

const baseProps: Omit<FilterSheetProps, "savedViews"> = {
  open: true,
  onOpenChange: mock(),
  columnFilters: {},
  onFilterChange: mock(),
  sortColumns: [],
  activeGroupKey: null,
  onGroupChange: mock(),
  onApplyView: mock(),
  viewQuery: () => "",
  selectMode: false,
  onToggleSelectMode: mock(),
};

function renderSheet(savedViews: SavedViewsConfig, role: MemberRole) {
  return render(
    <ProjectProvider project={{ id: 1, name: "Project", role }}>
      <FilterSheet {...baseProps} savedViews={savedViews} />
    </ProjectProvider>,
    { wrapper: MotionProvider }
  );
}

async function openRowMenu(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
  await act(async () => {});
}

describe("FilterSheet's Views section", () => {
  it("shows share and delete on the caller's own view when they can edit", async () => {
    renderSheet(viewsConfig([ownView]), "editor");

    await openRowMenu(/more actions for mine/i);

    expect(screen.getByRole("menuitem", { name: "Share" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
  });

  it("marks another member's shared view and offers only the default actions to an editor", async () => {
    renderSheet(viewsConfig([othersView]), "editor");

    expect(screen.getByText(/shared by alex/i)).toBeTruthy();
    await openRowMenu(/more actions for alex's view/i);

    expect(
      screen.getByRole("menuitem", { name: "Set as default" })
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Share" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  });

  it("lets an admin delete another member's shared view", async () => {
    renderSheet(viewsConfig([othersView]), "admin");

    await openRowMenu(/more actions for alex's view/i);

    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Share" })).toBeNull();
  });

  it("shares a view through the flipped flag", async () => {
    const savedViews = viewsConfig([ownView]);
    renderSheet(savedViews, "editor");

    await openRowMenu(/more actions for mine/i);
    fireEvent.click(screen.getByRole("menuitem", { name: "Share" }));
    await act(async () => {});

    expect(savedViews.onShare).toHaveBeenCalledWith(7, true);
  });

  it("uses auto height capped at 85dvh and resets all filters/grouping on Reset all", async () => {
    const onApplyView = mock();
    render(
      <ProjectProvider project={{ id: 1, name: "P", role: "editor" }}>
        <FilterSheet
          {...baseProps}
          onApplyView={onApplyView}
          columnFilters={{ status: "2" }}
        />
      </ProjectProvider>,
      { wrapper: MotionProvider }
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("h-auto");
    expect(dialog.className).toContain("max-h-[85dvh]");

    fireEvent.click(screen.getByRole("button", { name: "Reset all" }));
    expect(onApplyView).toHaveBeenCalledWith("");
  });
});
