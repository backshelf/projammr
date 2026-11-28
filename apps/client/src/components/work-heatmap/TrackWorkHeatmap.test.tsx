import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { HeatmapDay } from "@workspace/api/api";

const clientGetProjectHeatmap = mock();
mock.module("@/lib/client-api", () => ({
  clientGetProjectHeatmap,
}));

const { TrackWorkHeatmap } = await import("./TrackWorkHeatmap");

afterEach(() => {
  cleanup();
  clientGetProjectHeatmap.mockReset();
});

describe("TrackWorkHeatmap", () => {
  it("hides the entire WORKED ON rail block when there are 0 save days", async () => {
    clientGetProjectHeatmap.mockResolvedValue([] satisfies HeatmapDay[]);
    const { container } = render(
      <TrackWorkHeatmap projectId={3} trackId={12} />
    );

    await waitFor(() =>
      expect(clientGetProjectHeatmap).toHaveBeenCalledTimes(1)
    );
    expect(screen.queryByText("WORKED ON")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders WORKED ON and the save grid when days exist", async () => {
    clientGetProjectHeatmap.mockResolvedValue([
      {
        day: "2026-11-20",
        saves: 3,
        commits: 1,
        renders: 0,
        seconds: 600,
      },
    ]);

    render(<TrackWorkHeatmap projectId={3} trackId={12} />);

    expect(await screen.findByText("WORKED ON")).toBeTruthy();
    expect(screen.getByText(/1 day in the last 3 months/)).toBeTruthy();
  });
});
