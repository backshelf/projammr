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

function renderCell(listHref?: string, role: MemberRole = "editor") {
  return render(
    <ProjectProvider project={{ id: 3, name: "Project", role }}>
      <LabelsCell
        entityType={"track"}
        entityId={9}
        labels={LABELS}
        projectLabels={LABELS}
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

  it("leaves the labels pane out of a viewer's picker", async () => {
    renderCell(undefined, "viewer");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit labels" }));
    });

    expect(screen.getByPlaceholderText("Filter or create…")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Manage labels" })).toBeNull();
  });
});
