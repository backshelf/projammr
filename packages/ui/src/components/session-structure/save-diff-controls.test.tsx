import type { SaveMeta, SessionTrack } from "@workspace/api/api";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { changedTrackCount, diffSave } from "@workspace/session-diff";
import type { ReactNode } from "react";
import { SaveDiffCard } from "./save-diff-card";
import {
  SaveDiffControls,
  type SaveDiffMode,
  SaveDiffModeSwitch,
  SaveDiffStepper,
} from "./save-diff-controls";

const scrollIntoView = mock<(options?: ScrollIntoViewOptions) => void>();

beforeEach(() => {
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(cleanup);

const track = (
  name: string,
  over: Partial<SessionTrack> = {}
): SessionTrack => ({ kind: "audio", name, devices: [], ...over });

const meta = (tracks: SessionTrack[]): SaveMeta => ({
  tempo: "124",
  timeSignature: "4/4",
  rootNote: null,
  scale: null,
  tracksCount: null,
  scenesCount: null,
  dawVersion: null,
  samplePaths: null,
  structure: { tracks, clips: { audio: 0, midi: 0 } },
});

/** A DRUMS group of ten unchanged tracks, which arrives shut, then a lead
 *  that gains a device and a pad that is new. */
const DRUMS = [
  track("DRUMS", { kind: "group", id: 1 }),
  ...Array.from({ length: 10 }, (_, i) =>
    track(`Hit ${i}`, { id: 10 + i, groupId: 1 })
  ),
];
const BEFORE = meta([...DRUMS, track("Lead", { devices: ["EQ Eight"] })]);
const AFTER = meta([
  ...DRUMS,
  track("Lead", { devices: ["EQ Eight", "Saturator"] }),
  track("Pad"),
]);

function renderCard(
  diff = diffSave(BEFORE, AFTER, ["structure"]),
  extra?: ReactNode,
  defaultMode: SaveDiffMode = "whole"
) {
  return render(
    <SaveDiffControls
      changes={changedTrackCount(diff.structure)}
      defaultMode={defaultMode}
    >
      <SaveDiffCard
        diff={diff}
        saves={{
          before: { at: "2026-06-14T18:32:00Z" },
          after: { at: "2026-06-14T21:05:00Z" },
        }}
        asOf={new Date("2026-06-20T12:00:00Z")}
        timeZone="UTC"
        actions={
          <>
            <SaveDiffModeSwitch />
            <SaveDiffStepper />
            {extra}
          </>
        }
      />
    </SaveDiffControls>
  );
}

const wrapper = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(".group\\/save-diff")!;
const row = (container: HTMLElement, index: number) =>
  container.querySelector<HTMLElement>(`[data-diff-row="${index}"]`)!;
const bar = (container: HTMLElement, index: number) =>
  container.querySelector<HTMLElement>(`[data-diff-bar="${index}"]`)!;

// Rows in the set's order: DRUMS 0, its hits 1–10, Lead 11, Pad 12.
const LEAD = 11;
const PAD = 12;

describe("SaveDiffControls", () => {
  it("switches the outline between the whole set and only the changes", () => {
    const { container } = renderCard();
    expect(wrapper(container).dataset.mode).toBe("whole");

    fireEvent.click(screen.getByRole("button", { name: "Changes" }));
    expect(wrapper(container).dataset.mode).toBe("changes");
  });

  it("steps through the changed tracks in the set's order, and round again", () => {
    const { container } = renderCard();
    expect(screen.getByText("2 changes")).toBeTruthy();

    const next = screen.getByRole("button", { name: "Next change" });
    fireEvent.click(next);
    expect(screen.getByText("1 of 2")).toBeTruthy();
    expect(row(container, LEAD).hasAttribute("data-hot")).toBe(true);
    expect(bar(container, LEAD).hasAttribute("data-hot")).toBe(true);

    fireEvent.click(next);
    expect(screen.getByText("2 of 2")).toBeTruthy();
    expect(row(container, PAD).hasAttribute("data-hot")).toBe(true);
    expect(row(container, LEAD).hasAttribute("data-hot")).toBe(false);

    fireEvent.click(next);
    expect(screen.getByText("1 of 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Previous change" }));
    expect(screen.getByText("2 of 2")).toBeTruthy();
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      behavior: "auto",
    });
  });

  it("steps with ] and [ while focus is in the card, but not while typing", () => {
    renderCard(undefined, <input aria-label="Filter" />);

    fireEvent.keyDown(screen.getByRole("button", { name: "Next change" }), {
      key: "]",
    });
    expect(screen.getByText("1 of 2")).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("button", { name: "Next change" }), {
      key: "[",
    });
    expect(screen.getByText("2 of 2")).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Filter" }), {
      key: "]",
    });
    expect(screen.getByText("2 of 2")).toBeTruthy();
  });

  it("lights a row's bar under the pointer, and puts it out again", () => {
    const { container } = renderCard();

    fireEvent.pointerOver(row(container, PAD), { pointerType: "mouse" });
    expect(wrapper(container).hasAttribute("data-hot")).toBe(true);
    expect(bar(container, PAD).hasAttribute("data-hot")).toBe(true);
    expect(bar(container, LEAD).hasAttribute("data-hot")).toBe(false);

    fireEvent.pointerLeave(wrapper(container));
    expect(wrapper(container).hasAttribute("data-hot")).toBe(false);
    expect(bar(container, PAD).hasAttribute("data-hot")).toBe(false);
  });

  it("ignores a touch passing over the card", () => {
    const { container } = renderCard();
    fireEvent.pointerOver(row(container, PAD), { pointerType: "touch" });
    expect(wrapper(container).hasAttribute("data-hot")).toBe(false);
  });

  it("opens the shut group a clicked bar's track sits in, and lights its row", () => {
    const { container } = renderCard();
    const drums = row(container, 1).closest("details")!;
    expect(drums.open).toBe(false);

    fireEvent.click(bar(container, 1));
    expect(drums.open).toBe(true);
    expect(row(container, 1).hasAttribute("data-hot")).toBe(true);
  });

  it("offers neither control when the save changed no track", () => {
    renderCard(diffSave(BEFORE, BEFORE, ["structure"]));
    expect(screen.queryByRole("button", { name: "Changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next change" })).toBeNull();
  });

  it("shows the whole set when the save changed no track, even where the page asked for changes", () => {
    const { container } = renderCard(
      diffSave(BEFORE, BEFORE, ["structure"]),
      undefined,
      "changes"
    );
    expect(wrapper(container).dataset.mode).toBe("whole");
  });

  it("switches to the whole set to show a track the Changes view hides, when its bar is clicked", () => {
    const { container } = renderCard(undefined, undefined, "changes");
    expect(wrapper(container).dataset.mode).toBe("changes");
    const drums = row(container, 1).closest("details")!;

    fireEvent.click(bar(container, 1));
    expect(wrapper(container).dataset.mode).toBe("whole");
    expect(drums.open).toBe(true);
    expect(row(container, 1).hasAttribute("data-hot")).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("stays on the changes when a clicked bar's track is already among them", () => {
    const { container } = renderCard(undefined, undefined, "changes");

    fireEvent.click(bar(container, PAD));
    expect(wrapper(container).dataset.mode).toBe("changes");
    expect(row(container, PAD).hasAttribute("data-hot")).toBe(true);
  });
});
