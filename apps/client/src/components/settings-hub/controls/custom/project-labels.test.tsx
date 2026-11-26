import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { Label } from "@workspace/api/api";

type Result = Label[] | { error: string };
const getLabels = mock<(projectId: number) => Promise<Result>>();
mock.module("@/actions/labels", () => ({ getLabels }));

const { ProjectProvider } = await import("@/hooks/use-project-role");
const { ProjectLabelsControl } = await import("./project-labels");

function mount(value: number[]) {
  const onChange = mock<(value: unknown) => void>();
  render(
    <ProjectProvider project={{ id: 3, name: "Sessions", role: "editor" }}>
      <span id="labels-label">Default labels</span>
      <ProjectLabelsControl
        definition={{} as never}
        value={value}
        onChange={onChange}
        disabled={false}
        id="labels"
      />
    </ProjectProvider>
  );
  return onChange;
}

const label = (id: number, name: string): Label => ({
  id,
  name,
  // eslint-disable-next-line no-restricted-syntax -- a label's own colourHex, not a class name
  colourHex: "#336699",
  projectId: 3,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

/** Lets the fetch settle. */
const settle = () => act(async () => {});

beforeEach(() => {
  getLabels.mockReset();
});

afterEach(cleanup);

describe("ProjectLabelsControl", () => {
  it("fetches the project's labels once", () => {
    getLabels.mockResolvedValue([]);
    mount([]);

    expect(getLabels.mock.calls[0]?.[0]).toBe(3);
  });

  it("lists the project's labels as pills", async () => {
    getLabels.mockResolvedValue([label(1, "Vocal"), label(2, "Mix")]);
    mount([]);
    await settle();

    expect(screen.getByRole("button", { name: "Vocal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mix" })).toBeTruthy();
  });

  it("pressing a pill hands its id up alongside what was already chosen", async () => {
    getLabels.mockResolvedValue([label(1, "Vocal"), label(2, "Mix")]);
    const onChange = mount([2]);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Vocal" }));

    expect(onChange).toHaveBeenCalledWith([1, 2]);
  });

  it("lists a deleted label's id on its own, with a way to remove it", async () => {
    getLabels.mockResolvedValue([label(1, "Vocal")]);
    const onChange = mount([1, 9]);
    await settle();

    expect(screen.getByText("Label no longer exists")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove the label" }));

    expect(onChange).toHaveBeenCalledWith([1]);
  });

  it("reports a load failure", async () => {
    getLabels.mockResolvedValue({ error: "Failed to fetch labels" });
    mount([]);
    await settle();

    expect(screen.getByText("Failed to fetch labels")).toBeTruthy();
  });
});
