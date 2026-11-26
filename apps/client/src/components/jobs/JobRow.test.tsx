import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { Job } from "@workspace/api/api";

let live: Job | undefined;

mock.module("@/components/jobs/JobsProvider", () => ({
  useJob: mock(() => live),
}));

const { JobRow } = await import("./JobRow");

const job = (overrides: Partial<Job> = {}) =>
  ({
    id: 1,
    kind: "audio_analysis",
    status: "queued",
    percent: 0,
    steps: [],
    stepIndex: null,
    stepPercent: null,
    queuePosition: null,
    label: "Analysing audio",
    subjectLabel: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  }) as Job;

const noop = () => Promise.resolve();

function renderRow(canManage = false) {
  return render(
    <JobRow jobId={1} canManage={canManage} onCancel={noop} onRetry={noop} />
  );
}

afterEach(cleanup);

describe("JobRow", () => {
  it("shows a queued job's position and no meter", () => {
    live = job({ status: "queued", queuePosition: 3 });
    renderRow();

    expect(screen.getByText("Queued · #3")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows a running job's step label and a meter", () => {
    live = job({
      status: "running",
      percent: 40,
      startedAt: new Date().toISOString(),
      steps: [
        { key: "decode", label: "Decoding and measuring", weight: 80 },
        { key: "store", label: "Saving", weight: 20 },
      ],
      stepIndex: 0,
    } as Partial<Job>);
    renderRow();

    expect(screen.getByText("Decoding and measuring")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "40"
    );
  });

  it("offers cancel only to someone who can manage jobs", () => {
    live = job({ status: "queued", queuePosition: 1 });
    renderRow(false);
    expect(screen.queryByText("Cancel")).toBeNull();
    cleanup();

    renderRow(true);
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  it("renders nothing once the job has left the map", () => {
    live = undefined;
    const { container } = renderRow(true);

    expect(container.innerHTML).toBe("");
  });
});
