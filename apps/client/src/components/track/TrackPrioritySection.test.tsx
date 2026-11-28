import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

const refresh = mock();
mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

mock.module("sonner", () => ({ toast: { error: mock() } }));

const { defineMutation } = await import("@/lib/mutation");
const patchEntityFields = mock(
  (_kind: string, _id: number, body: Record<string, unknown>) =>
    defineMutation(async () => body, ["route"])
);
mock.module("@/entities/mutations", () => ({ patchEntityFields }));

const { HIGH, LEVEL_COLOURS, LOW, NONE, SEEDED_SCALE } =
  await import("@/fields/priority-fixture");
const { ProjectProvider } = await import("@/hooks/use-project-role");
const { TrackPrioritySection } = await import("./TrackPrioritySection");

afterEach(() => {
  cleanup();
  refresh.mockClear();
  patchEntityFields.mockClear();
});

const trigger = () => screen.getByRole("button");

async function openMenu() {
  await act(async () => {
    fireEvent.click(trigger());
  });
  return screen.findByRole("listbox");
}

describe("TrackPrioritySection", () => {
  it("shows the track's own level, in its colour, before the scale is read", () => {
    render(<TrackPrioritySection trackId={9} level={HIGH} levels={[]} />);

    const chip = trigger().querySelector<HTMLElement>(
      '[data-slot="status-chip"]'
    );
    expect(chip?.textContent).toBe("High");
    expect(chip?.style.getPropertyValue("--status")).toBe(LEVEL_COLOURS.ink);
  });

  it("shows the default level as a chip like any other", () => {
    render(<TrackPrioritySection trackId={9} level={NONE} levels={[]} />);

    expect(trigger().textContent).toBe("None");
  });

  it("offers the project's scale, bottom level first", async () => {
    render(
      <TrackPrioritySection trackId={9} level={LOW} levels={SEEDED_SCALE} />
    );

    const menu = await openMenu();
    expect(
      within(menu)
        .getAllByRole("option")
        .map((item) => item.textContent)
    ).toEqual(["None", "Low", "Medium", "High", "Urgent"]);
  });

  it("writes the picked level's id", async () => {
    render(
      <TrackPrioritySection trackId={9} level={LOW} levels={SEEDED_SCALE} />
    );

    const menu = await openMenu();
    await act(async () => {
      fireEvent.click(within(menu).getByRole("option", { name: "High" }));
    });

    expect(patchEntityFields).toHaveBeenCalledTimes(1);
    expect(patchEntityFields).toHaveBeenCalledWith("track", 9, {
      priorityId: HIGH.id,
    });
  });

  it("writes nothing when the track's own level is picked again", async () => {
    render(
      <TrackPrioritySection trackId={9} level={LOW} levels={SEEDED_SCALE} />
    );

    const menu = await openMenu();
    await act(async () => {
      fireEvent.click(within(menu).getByRole("option", { name: "Low" }));
    });

    expect(patchEntityFields).not.toHaveBeenCalled();
  });

  it("renders the badge read-only without a menu trigger for viewers", () => {
    render(
      <ProjectProvider project={{ id: 1, name: "P", role: "viewer" }}>
        <TrackPrioritySection trackId={9} level={HIGH} levels={SEEDED_SCALE} />
      </ProjectProvider>
    );

    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
