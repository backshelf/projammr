import { cleanup, render, screen, within } from "@testing-library/react";
import type { SampleUsage } from "@workspace/api/api";
import { afterEach, describe, expect, it } from "bun:test";
import { DEFAULT_SHELL } from "@/lib/policies/shell";
import { SessionSamples } from "./SessionSamples";

type Sample = {
  path: string;
  kind: "project" | "outside" | "library";
  status: "present" | "missing" | "unknown";
  held: boolean;
  object: string | null;
};

const KICK = "/Users/demo/Samples/Kicks/Invented Kick 01.wav";
const CHOP = "/Users/demo/Samples/Vox/Invented Vocal Chop.wav";
const SNARE = "/Users/demo/Library/Invented Library Snare.wav";
const PAD = "C:\\Users\\demo\\Samples\\Invented Pad Loop.wav";

const sample = (path: string, overrides: Partial<Sample> = {}): Sample => ({
  path,
  kind: "project",
  status: "present",
  held: false,
  object: null,
  ...overrides,
});

const used = (
  path: string,
  sessions: number,
  kind: SampleUsage["kind"] = "project"
): SampleUsage => ({ path, kind, sessions, sessionIds: [], missing: false });

const renderSamples = (
  samples: Sample[],
  usage?: SampleUsage[],
  defaults = DEFAULT_SHELL.inventoryDefaults.samples,
  repoId: number | null = null
) =>
  render(
    <SessionSamples
      session={{ id: 7, projectId: 3, repoId, samples }}
      usage={usage}
      defaults={defaults}
    />
  );

const hrefOf = (link: HTMLElement) =>
  new URL(link.getAttribute("href") ?? "", "http://localhost");

const rowOf = (name: string) => {
  const row = screen.getByText(name).closest("li");
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};

afterEach(cleanup);

describe("SessionSamples", () => {
  it("splits each path into the filename and its folder", () => {
    renderSamples([sample(KICK), sample(PAD)]);

    expect(
      within(rowOf("Invented Kick 01.wav")).getByText(
        "/Users/demo/Samples/Kicks"
      )
    ).toBeTruthy();
    expect(
      within(rowOf("Invented Pad Loop.wav")).getByText(
        "C:\\Users\\demo\\Samples"
      )
    ).toBeTruthy();
  });

  it("shows a bare filename with no folder line", () => {
    renderSamples([sample("Invented Kick 01.wav")]);

    expect(rowOf("Invented Kick 01.wav").textContent).toBe(
      "Invented Kick 01.wav"
    );
  });

  it("links a shared sample's other sets to its row on the samples page, not counting this session", () => {
    renderSamples([sample(KICK)], [used(KICK, 3)]);

    const link = within(rowOf("Invented Kick 01.wav")).getByRole("link");
    expect(link.textContent).toContain("in 2 other sets");
    const href = hrefOf(link);
    expect(href.pathname).toBe("/project/3/samples");
    expect(href.searchParams.get("sample")).toBe(KICK);
    expect(href.searchParams.has("library")).toBe(false);
  });

  it("says 'set' for a single other set", () => {
    renderSamples([sample(KICK)], [used(KICK, 2)]);

    expect(screen.getByRole("link").textContent).toContain("in 1 other set");
    expect(screen.getByRole("link").textContent).not.toContain("sets");
  });

  it("names the sample in the link's accessible name", () => {
    renderSamples([sample(KICK)], [used(KICK, 2)]);

    expect(
      screen.getByRole("link", {
        name: /in 1 other set.*Invented Kick 01\.wav/,
      })
    ).toBeTruthy();
  });

  it("opens the samples page's Library filter for a library sample's link", () => {
    renderSamples(
      [sample(SNARE, { kind: "library" })],
      [used(SNARE, 2, "library")]
    );

    const href = hrefOf(screen.getByRole("link"));
    expect(href.searchParams.get("library")).toBe("1");
    expect(href.searchParams.get("sample")).toBe(SNARE);
  });

  it("writes its links against the viewer's samples-page defaults", () => {
    renderSamples(
      [sample(KICK), sample(SNARE, { kind: "library" })],
      [used(KICK, 2), used(SNARE, 2, "library")],
      { show: "all", library: true, stock: false }
    );

    const [kick, snare] = screen.getAllByRole("link").map(hrefOf);
    // Library is on by default here, so a project sample's link turns it off
    // and a library sample's leaves it to the default.
    expect(kick?.searchParams.get("library")).toBe("0");
    expect(snare?.searchParams.has("library")).toBe(false);
  });

  it("shows no reach for a sample only this session uses", () => {
    renderSamples([sample(KICK)], [used(KICK, 1)]);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(/other set/)).toBeNull();
  });

  it("shows rows without reach when the usage did not load", () => {
    renderSamples([sample(KICK)], undefined);

    expect(screen.getByText("Invented Kick 01.wav")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("marks a missing sample with the removal glyph, the struck name and the word", () => {
    renderSamples([sample(CHOP, { status: "missing" })]);

    const row = rowOf("Invented Vocal Chop.wav");
    expect(within(row).getByText("missing")).toBeTruthy();
    expect(within(row).getByText("−").getAttribute("aria-hidden")).toBe("true");
    expect(
      within(row).getByText(/Invented Vocal Chop\.wav/).className
    ).toContain("line-through");
  });

  it("does not mark a present or unknown sample as missing", () => {
    renderSamples([sample(KICK), sample(PAD, { status: "unknown" })]);

    expect(screen.queryByText("missing")).toBeNull();
    expect(screen.queryByText("−")).toBeNull();
  });

  it("counts what Live can't find, singular for one", () => {
    renderSamples([sample(CHOP, { status: "missing" }), sample(KICK)]);

    expect(screen.getByText("Live can't find 1 sample")).toBeTruthy();
  });

  it("counts what Live can't find, plural for several", () => {
    renderSamples([
      sample(CHOP, { status: "missing" }),
      sample(KICK, { status: "missing" }),
    ]);

    expect(screen.getByText("Live can't find 2 samples")).toBeTruthy();
  });

  it("points at Collect All and Save when a sample sits outside the project", () => {
    renderSamples([sample(KICK, { kind: "outside" })]);

    expect(
      screen.getByText(
        "Collect All and Save in Live brings these into the project."
      )
    ).toBeTruthy();
    expect(screen.queryByText(/can't find/)).toBeNull();
  });

  it("shows neither trouble line when every sample is in the project, in the library or unknown", () => {
    renderSamples([
      sample(KICK),
      sample(SNARE, { kind: "library" }),
      sample(PAD, { status: "unknown" }),
    ]);

    expect(screen.queryByText(/can't find/)).toBeNull();
    expect(screen.queryByText(/Collect All/)).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("says nothing of the hub for a set with no repo", () => {
    renderSamples([sample(KICK)]);
    expect(screen.queryByText("not pushed")).toBeNull();
    expect(screen.queryByText("on the hub")).toBeNull();
  });

  it("states each sample's place in a repo and offers a download only for a held one", () => {
    renderSamples(
      [
        sample(KICK, { held: true, object: "ab".repeat(32) }),
        sample(CHOP),
        sample(SNARE, { kind: "outside" }),
        sample(PAD, { status: "missing" }),
      ],
      undefined,
      DEFAULT_SHELL.inventoryDefaults.samples,
      9
    );

    expect(
      within(rowOf("Invented Kick 01.wav")).getByText("on the hub")
    ).toBeTruthy();
    expect(
      within(rowOf("Invented Vocal Chop.wav")).getByText("not pushed")
    ).toBeTruthy();
    expect(
      within(rowOf("Invented Library Snare.wav")).getByText(
        "outside the project folder"
      )
    ).toBeTruthy();
    expect(
      within(rowOf("Invented Pad Loop.wav")).getByText("missing")
    ).toBeTruthy();

    const link = within(rowOf("Invented Kick 01.wav")).getByRole("link", {
      name: /Download/,
    });
    expect(link.getAttribute("href")).toBe(
      `/api/samples/${"ab".repeat(32)}?repo=9`
    );
    expect(
      within(rowOf("Invented Vocal Chop.wav")).queryByRole("link", {
        name: /Download/,
      })
    ).toBeNull();
  });
});
