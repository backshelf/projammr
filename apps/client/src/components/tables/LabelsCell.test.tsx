import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Label, MemberRole } from "@workspace/api/api";

mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: mock() }),
}));

// next/link updates state as it mounts, outside any act() the test can wrap.
mock.module("@/components/navigation/AppLink", () => ({
  AppLink: ({ href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props} />
  ),
}));

const { ProjectProvider } = await import("@/hooks/use-project-role");
const { LabelsCell } = await import("./LabelsCell");

afterEach(cleanup);

const LABELS = [
  // eslint-disable-next-line no-restricted-syntax -- a label's own colourHex, not a class name
  { id: 4, name: "Single", colourHex: "#d05a3c" },
  // eslint-disable-next-line no-restricted-syntax -- a label's own colourHex, not a class name
  { id: 7, name: "Demo", colourHex: "#3c7ad0" },
] as Label[];

const MANY_LABELS = [
  ...LABELS,
  // eslint-disable-next-line no-restricted-syntax -- a label's own colourHex, not a class name
  { id: 9, name: "Master", colourHex: "#2e8b57" },
  // eslint-disable-next-line no-restricted-syntax -- a label's own colourHex, not a class name
  { id: 12, name: "Remix", colourHex: "#8a4fff" },
] as Label[];

function renderCell(
  listHref?: string,
  role: MemberRole = "editor",
  labels: Label[] = LABELS
) {
  return render(
    <ProjectProvider project={{ id: 3, name: "Project", role }}>
      <LabelsCell
        entityType={"track"}
        entityId={9}
        labels={labels}
        projectLabels={labels}
        listHref={listHref}
      />
    </ProjectProvider>
  );
}

describe("LabelsCell", () => {
  it("links each badge to the list filtered to its label", () => {
    renderCell("/project/3/track/all");

    expect(
      screen.getByRole("link", { name: "Single" }).getAttribute("href")
    ).toBe("/project/3/track/all?label=4");
    expect(
      screen.getByRole("link", { name: "Demo" }).getAttribute("href")
    ).toBe("/project/3/track/all?label=7");
  });

  it("leaves the badges plain without a list to link to", () => {
    renderCell();

    expect(screen.getByText("Single")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Single" })).toBeNull();
  });

  it("offers an editor the project's labels pane from the picker", async () => {
    renderCell(undefined, "editor");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit labels" }));
    });

    expect(
      screen.getByRole("link", { name: "Manage labels" }).getAttribute("href")
    ).toBe("/settings/project/3/labels");
  });

  it("hides the Edit labels trigger for a viewer while keeping read-only badges", () => {
    renderCell(undefined, "viewer");

    expect(screen.getByText("Single")).toBeTruthy();
    expect(screen.getByText("Demo")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit labels" })).toBeNull();
  });

  it("keeps badges on a single line and collapses overflow into a +N popover", async () => {
    const { container } = renderCell(
      "/project/3/track/all",
      "editor",
      MANY_LABELS
    );

    expect(container.firstElementChild?.className).toContain("flex-nowrap");
    expect(container.firstElementChild?.className).not.toContain("flex-wrap");
    expect(screen.getByRole("link", { name: "Single" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Demo" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Master" })).toBeNull();

    const pill = screen.getByRole("button", { name: "Show 2 more labels" });
    expect(pill.textContent).toBe("+2");

    await act(async () => {
      fireEvent.click(pill);
    });

    expect(
      screen.getByRole("link", { name: "Master" }).getAttribute("href")
    ).toBe("/project/3/track/all?label=9");
    expect(
      screen.getByRole("link", { name: "Remix" }).getAttribute("href")
    ).toBe("/project/3/track/all?label=12");
  });
});
