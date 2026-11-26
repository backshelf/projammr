import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import type { SampleUsage, SessionSummary } from "@workspace/api/api";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";

const getProjectSamples = mock();
const cachedSessionSummaries = mock();

mock.module("@/actions/projects", () => ({ getProjectSamples }));
mock.module("@/lib/server-data", () => ({ cachedSessionSummaries }));
let policies = DEFAULT_POLICIES;
mock.module("@/lib/policies/server", () => ({
  cachedPolicies: async () => policies,
}));

const { SamplesInventory } = await import("./SamplesInventory");

const session = (id: number, name: string): SessionSummary => ({
  id,
  name,
  daw: "ableton",
  trackId: null,
  main: false,
  updatedAt: "2026-09-01T00:00:00.000Z",
  archived: false,
});

const usage = (
  path: string,
  sessionIds: number[],
  extra: Partial<SampleUsage> = {}
): SampleUsage => ({
  path,
  kind: "project",
  sessions: sessionIds.length,
  sessionIds,
  missing: false,
  ...extra,
});

const SESSIONS = [session(1, "Invented Set A"), session(2, "Invented Set B")];
const USAGE = [
  usage("/Users/demo/Samples/Shared Kick.wav", [1, 2]),
  usage("/Users/demo/Samples/Lost Hat.wav", [1, 2], { missing: true }),
  usage("/Library/Core/Drums/Core Clap.wav", [1, 2], { kind: "library" }),
];

const renderSection = async (library: boolean) =>
  render(await SamplesInventory({ projectId: 7, library }));

const link = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll("a")].find((a) => a.textContent === text);

beforeEach(() => {
  getProjectSamples.mockReset();
  cachedSessionSummaries.mockReset();
  getProjectSamples.mockResolvedValue(USAGE);
  cachedSessionSummaries.mockResolvedValue(SESSIONS);
  policies = DEFAULT_POLICIES;
});

describe("SamplesInventory", () => {
  test("states the counts with the Library toggle off", async () => {
    const { container } = await renderSection(false);

    expect(container.textContent).toContain(
      "2 samples across 2 sets · 2 shared · 1 missing"
    );
  });

  test("counts library samples when the toggle is on", async () => {
    const { container } = await renderSection(true);

    expect(container.textContent).toContain(
      "3 samples across 2 sets · 3 shared · 1 missing"
    );
  });

  test("links the toggle to the project page with the state flipped", async () => {
    const off = await renderSection(false);
    const pill = link(off.container, "Library");
    expect(pill?.getAttribute("href")).toBe("/project/7?library=1");
    expect(pill?.getAttribute("aria-label")).toBe("Show Library samples");
    expect(pill?.hasAttribute("data-pressed")).toBe(false);
    off.unmount();

    const on = await renderSection(true);
    const pressed = link(on.container, "Library");
    expect(pressed?.getAttribute("href")).toBe("/project/7");
    expect(pressed?.getAttribute("aria-label")).toBe("Hide Library samples");
    expect(pressed?.hasAttribute("data-pressed")).toBe(true);
  });

  test("carries the Library state into the All samples link", async () => {
    const off = await renderSection(false);
    expect(link(off.container, "All samples")?.getAttribute("href")).toBe(
      "/project/7/samples"
    );
    off.unmount();

    const on = await renderSection(true);
    expect(link(on.container, "All samples")?.getAttribute("href")).toBe(
      "/project/7/samples?library=1"
    );
  });

  test("writes both links against a viewer whose Library is on by default", async () => {
    const samples = DEFAULT_POLICIES.shell.inventoryDefaults.samples;
    policies = {
      ...DEFAULT_POLICIES,
      shell: {
        ...DEFAULT_POLICIES.shell,
        inventoryDefaults: {
          ...DEFAULT_POLICIES.shell.inventoryDefaults,
          samples: { ...samples, library: true },
        },
      },
    };

    const on = await renderSection(true);
    expect(link(on.container, "Library")?.getAttribute("href")).toBe(
      "/project/7?library=0"
    );
    expect(link(on.container, "All samples")?.getAttribute("href")).toBe(
      "/project/7/samples"
    );
    on.unmount();

    const off = await renderSection(false);
    expect(link(off.container, "Library")?.getAttribute("href")).toBe(
      "/project/7"
    );
    expect(link(off.container, "All samples")?.getAttribute("href")).toBe(
      "/project/7/samples?library=0"
    );
  });

  test("still shows the section when only library samples exist and the toggle is off", async () => {
    getProjectSamples.mockResolvedValue([USAGE[2]]);

    const { container } = await renderSection(false);

    expect(container.textContent).toContain("0 samples across 0 sets");
  });

  test("renders nothing when the project has no sample", async () => {
    getProjectSamples.mockResolvedValue([]);

    expect(await SamplesInventory({ projectId: 7, library: false })).toBeNull();
  });

  test("renders nothing when either read fails", async () => {
    getProjectSamples.mockResolvedValue({ error: "boom" });
    expect(await SamplesInventory({ projectId: 7, library: false })).toBeNull();

    getProjectSamples.mockResolvedValue(USAGE);
    cachedSessionSummaries.mockResolvedValue({ error: "boom" });
    expect(await SamplesInventory({ projectId: 7, library: false })).toBeNull();
  });
});
