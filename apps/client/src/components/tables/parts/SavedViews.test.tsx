import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

import type { MemberRole } from "@workspace/api/api";

import type { DataTableProps } from "../generic-table-types";
import { renderGrid, type Row } from "../test-support";

// happy-dom starts on about:blank, where `history.replaceState` is ignored, so
// the location is set through the window's own controller.
type HappyWindow = { happyDOM: { setURL(url: string): void } };
const happyDOM = (window as unknown as HappyWindow).happyDOM;
const START_URL = window.location.href;

afterEach(() => happyDOM.setURL(START_URL));

type Views = NonNullable<DataTableProps<Row>["savedViews"]>;

const justTwo: Views["views"][number] = {
  id: 7,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  projectId: 1,
  ownerId: "user-1",
  shared: false,
  owner: { id: "user-1", name: "Owner" },
  name: "Just Two",
  kind: "track",
  config: { query: "q=Two" },
};

const othersView: Views["views"][number] = {
  ...justTwo,
  id: 9,
  ownerId: "user-2",
  shared: true,
  owner: { id: "user-2", name: "Alex" },
  name: "Alex's View",
  config: { query: "q=Alex" },
};

function viewsConfig(views: Views["views"] = [justTwo]): Views {
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

/** Renders a table that owns the URL, once it has adopted it. */
async function renderOwningUrl(savedViews?: Views, role?: MemberRole) {
  happyDOM.setURL("http://localhost/project/1/tracks");
  const result = renderGrid(role, undefined, {
    persistStateInUrl: true,
    savedViews,
  });
  await act(async () => {});
  return result;
}

async function openViews() {
  fireEvent.click(screen.getByRole("button", { name: /views/i }));
  await act(async () => {});
}

describe("SavedViews", () => {
  it("lists the configured views in its menu", async () => {
    await renderOwningUrl(viewsConfig());

    await openViews();

    expect(screen.getByText("Just Two")).toBeTruthy();
  });

  it("applies a view's query to the table when it is chosen", async () => {
    await renderOwningUrl(viewsConfig());
    expect(screen.getByText("One")).toBeTruthy();

    await openViews();
    fireEvent.click(screen.getByText("Just Two"));
    await act(async () => {});

    expect(screen.queryByText("One")).toBeNull();
    expect(screen.getByText("Two")).toBeTruthy();
  });

  it("saves the current view's query under the name entered", async () => {
    const savedViews = viewsConfig([]);
    await renderOwningUrl(savedViews);
    const [search] = screen.getAllByLabelText("Search the table");
    fireEvent.change(search!, { target: { value: "Two" } });

    await openViews();
    fireEvent.change(screen.getByPlaceholderText(/save current view as/i), {
      target: { value: "Mine" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(savedViews.onSave).toHaveBeenCalledWith("Mine", "q=Two");
  });

  it("round-trips the Explicit and a custom field's filter through the URL and a saved view", async () => {
    const savedViews = viewsConfig([
      { ...justTwo, name: "Clean", config: { query: "explicit=false" } },
    ]);
    const filterColumns: DataTableProps<Row>["filterColumns"] = [
      {
        id: "explicit",
        label: "Explicit",
        param: "explicit",
        options: [
          { value: "true", label: "Explicit" },
          { value: "false", label: "Not explicit" },
        ],
      },
      {
        id: "cf_2",
        label: "Energy",
        param: "cf_2",
        control: "range",
        input: "number",
      },
    ];
    happyDOM.setURL("http://localhost/project/1/tracks?explicit=true&cf_2=5..");
    renderGrid(undefined, undefined, {
      persistStateInUrl: true,
      savedViews,
      filterColumns,
    });
    await act(async () => {});

    expect(
      screen.getByRole("button", { name: "Explicit: Explicit" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Energy: ≥ 5" })).toBeTruthy();

    await openViews();
    fireEvent.change(screen.getByPlaceholderText(/save current view as/i), {
      target: { value: "Loud and explicit" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(savedViews.onSave).toHaveBeenCalledWith(
      "Loud and explicit",
      "explicit=true&cf_2=5.."
    );

    fireEvent.click(screen.getByText("Clean"));
    await act(async () => {});
    expect(
      screen.getByRole("button", { name: "Explicit: Not explicit" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Energy" })).toBeTruthy();
    expect(window.location.search).toBe("?explicit=false");
  });

  it("deletes a view once the confirmation is accepted", async () => {
    const savedViews = viewsConfig();
    await renderOwningUrl(savedViews, "editor");

    await openViews();
    fireEvent.click(
      screen.getByRole("button", { name: /more actions for just two/i })
    );
    await act(async () => {});
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await act(async () => {});

    expect(savedViews.onDelete).toHaveBeenCalledWith(7);
  });

  it("marks the default view with a star and offers Clear default in its menu", async () => {
    const savedViews = { ...viewsConfig(), defaultViewId: 7 };
    await renderOwningUrl(savedViews, "editor");

    await openViews();

    expect(screen.getByText("Default view")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /more actions for just two/i })
    );
    await act(async () => {});
    expect(
      screen.getByRole("menuitem", { name: "Clear default" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: "Set as default" })
    ).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "Clear default" }));
    expect(savedViews.onClearDefault).toHaveBeenCalledWith(7);
  });

  it("offers Set as default on a view that is not the default", async () => {
    const savedViews = viewsConfig();
    await renderOwningUrl(savedViews, "editor");

    await openViews();

    expect(screen.queryByText("Default view")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /more actions for just two/i })
    );
    await act(async () => {});
    expect(
      screen.getByRole("menuitem", { name: "Set as default" })
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Set as default" }));
    expect(savedViews.onSetDefault).toHaveBeenCalledWith(7);
  });

  it("shows share and delete on the caller's own view when they can edit", async () => {
    const savedViews = viewsConfig();
    await renderOwningUrl(savedViews, "editor");

    await openViews();
    fireEvent.click(
      screen.getByRole("button", { name: /more actions for just two/i })
    );
    await act(async () => {});

    expect(screen.getByRole("menuitem", { name: "Share" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
  });

  it("marks another member's shared view and offers only the default actions to an editor", async () => {
    await renderOwningUrl(viewsConfig([othersView]), "editor");

    await openViews();

    expect(screen.getByText(/shared by alex/i)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /more actions for alex's view/i })
    );
    await act(async () => {});

    expect(
      screen.getByRole("menuitem", { name: "Set as default" })
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Share" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  });

  it("lets an admin delete another member's shared view", async () => {
    await renderOwningUrl(viewsConfig([othersView]), "admin");

    await openViews();
    fireEvent.click(
      screen.getByRole("button", { name: /more actions for alex's view/i })
    );
    await act(async () => {});

    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Share" })).toBeNull();
  });

  it("shares a view through the flipped flag", async () => {
    const savedViews = viewsConfig();
    await renderOwningUrl(savedViews, "editor");

    await openViews();
    fireEvent.click(
      screen.getByRole("button", { name: /more actions for just two/i })
    );
    await act(async () => {});
    fireEvent.click(screen.getByRole("menuitem", { name: "Share" }));
    await act(async () => {});

    expect(savedViews.onShare).toHaveBeenCalledWith(7, true);
  });

  it("renders no menu without a savedViews config", async () => {
    await renderOwningUrl(undefined);

    expect(screen.queryByRole("button", { name: /views/i })).toBeNull();
  });

  it("renders no menu on a table that does not own the URL", () => {
    renderGrid(undefined, undefined, {
      persistStateInUrl: false,
      savedViews: viewsConfig(),
    });

    expect(screen.queryByRole("button", { name: /views/i })).toBeNull();
  });
});
