import type { TrackSummary } from "@workspace/api/api";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

// `pickers` imports server actions that load `server-only`; `mock.module` is
// not hoisted, so it runs before the dynamic import.
mock.module("server-only", () => ({}));

const { TrackRow } = await import("./pickers");

afterEach(cleanup);

const track = (archivedAt: string | null): TrackSummary => ({
  id: 1,
  title: "Night Drive",
  image: null,
  statusId: null,
  updatedAt: "2026-09-01T00:00:00Z",
  archivedAt,
  artists: [],
  bpm: null,
  key: null,
  keyTonic: null,
  keyScale: null,
  artwork: null,
});

describe("TrackRow", () => {
  it("shows the Archived flag for an archived track", () => {
    render(<TrackRow track={track("2026-09-01T00:00:00Z")} />);
    expect(screen.getByText("Night Drive")).toBeTruthy();
    expect(screen.getByText("Archived")).toBeTruthy();
  });

  it("shows no flag for a live track", () => {
    render(<TrackRow track={track(null)} />);
    expect(screen.getByText("Night Drive")).toBeTruthy();
    expect(screen.queryByText("Archived")).toBeNull();
  });
});
