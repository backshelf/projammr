import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { GetTrack } from "@workspace/api/api";

const write = mock();
mock.module("@/hooks/use-param-writer", () => ({
  useParamWriter: () => ({ write }),
}));

mock.module("@/lib/client-api", () => ({
  clientGetMyMachines: mock(async () => ({ machines: [] })),
}));

mock.module("@/components/session/OpenInDawButton", () => ({
  OpenInDawButton: () => <button type="button">Open in DAW</button>,
}));

const { TrackStudioRailBlock, TrackStudioEmptyControl } =
  await import("./TrackStudioRailBlock");

afterEach(() => {
  cleanup();
  write.mockReset();
});

const EMPTY_STUDIO: GetTrack["studio"] = {
  sessionCount: 0,
  commitCount: 0,
  saveCount: 0,
  lastSaveAt: null,
  openOn: null,
  openSessionId: null,
  mainSession: null,
};

const POPULATED_STUDIO: GetTrack["studio"] = {
  sessionCount: 2,
  commitCount: 5,
  saveCount: 14,
  lastSaveAt: "2026-11-27T10:00:00Z",
  openOn: {
    machine: "Studio Mac",
    owner: { id: "u1", name: "Alex" },
  },
  openSessionId: 11,
  mainSession: {
    id: 11,
    name: "Midnight_v4.als",
    daw: "ableton",
    dawName: "Ableton Live",
    dawVersion: "Live 12.1",
    repoId: null,
    main: true,
  },
};

describe("TrackStudioRailBlock", () => {
  it("renders nothing when the track has 0 DAW sets", () => {
    const { container } = render(
      <TrackStudioRailBlock studio={EMPTY_STUDIO} />
    );
    expect(container.textContent).toBe("");
  });

  it("renders summary, active openOn dot, and opens the Studio drawer on click", () => {
    const { container } = render(
      <TrackStudioRailBlock studio={POPULATED_STUDIO} />
    );

    expect(screen.getByText("STUDIO / DAW")).toBeTruthy();
    expect(screen.getByText(/Midnight_v4\.als · Live 12\.1/)).toBeTruthy();
    expect(screen.getByText(/2 sets · 5 commits · saved/)).toBeTruthy();
    expect(
      container.querySelector('[title="Open on Studio Mac (Alex)"]')
    ).not.toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /Inspect DAW & history/ })
    );
    expect(write).toHaveBeenCalledWith({
      studio: "overview",
      session: "11",
    });
  });

  it("wires TrackStudioEmptyControl to open the drawer", () => {
    render(<TrackStudioEmptyControl />);
    fireEvent.click(screen.getByRole("button", { name: /DAW set/ }));
    expect(write).toHaveBeenCalledWith({ studio: "overview" });
  });
});
