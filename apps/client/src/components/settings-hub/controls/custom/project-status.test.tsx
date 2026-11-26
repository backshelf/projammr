import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { Status } from "@workspace/api/api";
import { MotionProvider } from "@workspace/ui/components/motion-provider";

type Result = Status[] | { error: string };
const getStatuses = mock<(projectId: number) => Promise<Result>>();
mock.module("@/actions/statuses", () => ({ getStatuses }));

const { ProjectProvider } = await import("@/hooks/use-project-role");
const { ProjectStatusControl } = await import("./project-status");

function mount(value: number | null) {
  const onChange = mock<(value: unknown) => void>();
  render(
    <ProjectProvider project={{ id: 3, name: "Sessions", role: "editor" }}>
      <span id="status-label">Track status</span>
      <ProjectStatusControl
        definition={{} as never}
        value={value}
        onChange={onChange}
        disabled={false}
        id="status"
      />
    </ProjectProvider>,
    { wrapper: MotionProvider }
  );
  return onChange;
}

/**
 * Opens the popup and picks an item by its label. A pointerdown must land on
 * the item before its click counts as a real pick — Base UI ignores a click
 * with no pointerdown of its own, so a trigger's own opening click can't
 * auto-select whatever `alignItemWithTrigger` places under the cursor.
 */
function pick(label: string) {
  fireEvent.click(screen.getByRole("combobox"));
  const item = screen.getByRole("option", { name: label });
  fireEvent.pointerDown(item);
  fireEvent.click(item);
}

const status = (id: number, name: string): Status => ({
  id,
  name,
  percentage: 0,
  description: null,
  // eslint-disable-next-line no-restricted-syntax -- a status's own colourHex, not a class name
  colourHex: "#336699",
  projectId: 3,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

/** Lets the fetch settle. */
const settle = () => act(async () => {});

beforeEach(() => {
  getStatuses.mockReset();
});

afterEach(cleanup);

describe("ProjectStatusControl", () => {
  it("disables the select until the statuses arrive", () => {
    getStatuses.mockResolvedValue([]);
    mount(null);

    expect(screen.getByRole("combobox").hasAttribute("disabled")).toBe(true);
    expect(getStatuses.mock.calls[0]?.[0]).toBe(3);
  });

  it("lists the project's statuses once fetched", async () => {
    getStatuses.mockResolvedValue([status(1, "Mixing"), status(2, "Mastered")]);
    mount(null);
    await settle();

    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: "Mixing" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Mastered" })).toBeTruthy();
  });

  it("selecting a status hands its id up", async () => {
    getStatuses.mockResolvedValue([status(1, "Mixing")]);
    const onChange = mount(null);
    await settle();

    pick("Mixing");

    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("says so when the stored status has been deleted", async () => {
    getStatuses.mockResolvedValue([status(1, "Mixing")]);
    mount(9);
    await settle();

    expect(screen.getByText(/Status no longer exists/)).toBeTruthy();
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: "Not available" })).toBeTruthy();
  });

  it("reports a load failure", async () => {
    getStatuses.mockResolvedValue({ error: "Failed to fetch statuses" });
    mount(null);
    await settle();

    expect(screen.getByText("Failed to fetch statuses")).toBeTruthy();
  });
});
