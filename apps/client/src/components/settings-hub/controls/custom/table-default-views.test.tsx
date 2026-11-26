import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { SavedView } from "@workspace/api/api";

const useHub = mock<() => { projectId: number | null }>(() => ({
  projectId: 1,
}));
mock.module("../../hub-rows", () => ({ useHub }));

const view = (id: number, name: string): SavedView => ({
  id,
  name,
  kind: "track",
  projectId: 1,
  shared: false,
  config: { query: "" },
  owner: { id: "u1", name: "Owner" },
  ownerId: "u1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

type Result = { data?: unknown; error?: unknown; response: Response };
const GET = mock<(path: string, init: unknown) => Promise<Result>>(
  async (_path, init) => {
    const kind = (init as { params: { query: { kind: string } } }).params.query
      .kind;
    return {
      data: kind === "track" ? [view(11, "By status")] : [],
      response: new Response(),
    };
  }
);
mock.module("@/lib/browser-api", () => ({ browserApi: { GET } }));

const { TableDefaultViewsControl } = await import("./table-default-views");

function mount(value: unknown, disabled = false) {
  const onChange = mock<(value: unknown) => void>();
  render(
    <TableDefaultViewsControl
      definition={{} as never}
      value={value}
      onChange={onChange}
      disabled={disabled}
      id="default-views"
    />
  );
  return onChange;
}

const settle = () => act(async () => {});

afterEach(() => {
  cleanup();
  GET.mockClear();
  useHub.mockReturnValue({ projectId: 1 });
});

describe("TableDefaultViewsControl", () => {
  it("shows None for a kind with no default", async () => {
    mount({});
    await settle();

    expect(screen.getByText("Collections:")).toBeTruthy();
    const clear = screen.getByRole("button", {
      name: "Clear the default collections view",
    });
    expect(clear.hasAttribute("disabled")).toBe(true);
  });

  it("shows the default view's name once it resolves, and enables Clear", async () => {
    mount({ "1": { track: 11 } });
    await settle();

    expect(screen.getByText("By status")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Clear the default tracks view" })
        .hasAttribute("disabled")
    ).toBe(false);
  });

  it("Clear keeps other kinds' and other projects' entries", async () => {
    const onChange = mount({
      "1": { track: 11, session: 5 },
      "2": { track: 9 },
    });
    await settle();

    fireEvent.click(
      screen.getByRole("button", { name: "Clear the default tracks view" })
    );

    expect(onChange).toHaveBeenCalledWith({
      "1": { session: 5 },
      "2": { track: 9 },
    });
  });

  it("points to a project's settings on a page with no project", () => {
    useHub.mockReturnValue({ projectId: null });
    mount({});

    expect(
      screen.getByText("Open a project's settings to see its defaults.")
    ).toBeTruthy();
  });
});
