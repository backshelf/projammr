import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MotionProvider } from "./motion-provider";
import { playedBars, WaveMarks, Waveform } from "./waveform";

afterEach(cleanup);

const PEAKS = [0.1, 0.4, 0.8, 0.2];

const barCount = (html: string) => html.match(/<i style="--h:/g)?.length ?? 0;

describe("Waveform", () => {
  it("draws the peaks as the requested number of bars, each with its height and slot", () => {
    const html = renderToStaticMarkup(
      <Waveform peaks={PEAKS} count={4} label="Waveform of Signal" />
    );
    expect(barCount(html)).toBe(4);
    expect(html).toContain('<i style="--h:100%;--i:2"></i>');
    // A bar never draws shorter than its floor, so silence still reads as a wave.
    expect(html).toContain('<i style="--h:12.5%;--i:0"></i>');
    expect(html).toContain('role="img" aria-label="Waveform of Signal"');
  });

  it("lights the bars behind the playhead through --played", () => {
    const html = renderToStaticMarkup(
      <Waveform peaks={PEAKS} count={4} progress={0.5} label="Wave" />
    );
    expect(html).toContain('style="--played:2"');
  });

  it("leaves every bar unlit without a progress", () => {
    const html = renderToStaticMarkup(
      <Waveform peaks={PEAKS} count={4} label="Wave" />
    );
    expect(html).not.toContain("--played");
  });

  it("places a comment pin along the duration and names it for a screen reader", () => {
    const html = renderToStaticMarkup(
      <Waveform
        peaks={PEAKS}
        count={4}
        duration={120}
        marks={[{ id: 1, positionMs: 30_000, author: "Sam", excerpt: "Hi" }]}
        label="Wave"
      />
    );
    expect(html).toContain("left:25%");
    expect(html).toContain('aria-label="Comment by Sam at 0:30"');
  });

  it("leaves an open pin without the resolved marker", () => {
    const html = renderToStaticMarkup(
      <Waveform
        peaks={PEAKS}
        count={4}
        duration={120}
        marks={[{ id: 1, positionMs: 30_000, author: "Sam" }]}
        label="Wave"
      />
    );
    expect(html).not.toContain("data-resolved");
    expect(html).not.toContain("Resolved");
  });

  it("marks a resolved pin for the styles and names it resolved, with or without an author", () => {
    const html = renderToStaticMarkup(
      <Waveform
        peaks={PEAKS}
        count={4}
        duration={120}
        marks={[
          { id: 1, positionMs: 30_000, author: "Sam", resolved: true },
          { id: 2, positionMs: 42_000, resolved: true },
        ]}
        label="Wave"
      />
    );
    expect(html.match(/data-resolved=""/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Resolved comment by Sam at 0:30"');
    expect(html).toContain('aria-label="Resolved comment at 0:42"');
  });

  it("draws the drop-line as its own element beside the dot", () => {
    const html = renderToStaticMarkup(
      <Waveform
        peaks={PEAKS}
        count={4}
        duration={120}
        marks={[{ id: 1, positionMs: 30_000 }]}
        label="Wave"
      />
    );
    expect(html).toContain("<i></i><span></span>");
  });

  it("draws no pins without a duration to place them along", () => {
    const html = renderToStaticMarkup(
      <Waveform
        peaks={PEAKS}
        count={4}
        marks={[{ id: 1, positionMs: 30_000 }]}
        label="Wave"
      />
    );
    expect(html).not.toContain("Comment at");
  });

  it("draws a compared series behind the wave on the same bar count", () => {
    const html = renderToStaticMarkup(
      <Waveform
        peaks={PEAKS}
        comparePeaks={[0.5, 0.5]}
        count={4}
        label="Wave"
      />
    );
    expect(barCount(html)).toBe(8);
    expect(html).toContain('aria-hidden="true"');
  });

  it("draws nothing but the frame for a wave with no peaks", () => {
    const html = renderToStaticMarkup(<Waveform peaks={[]} label="Wave" />);
    expect(barCount(html)).toBe(0);
  });
});

describe("WaveMarks", () => {
  it("still seeks when a resolved pin is clicked", () => {
    const onMarkerClick = mock();
    render(
      <WaveMarks
        marks={[{ id: 7, positionMs: 30_000, resolved: true }]}
        duration={120}
        onMarkerClick={onMarkerClick}
      />
    );

    fireEvent.click(screen.getByRole("button"));

    expect(onMarkerClick).toHaveBeenCalledWith([7]);
  });

  it("closes a resolved pin's note with who resolved it", () => {
    render(
      <WaveMarks
        marks={[
          {
            id: 1,
            positionMs: 30_000,
            author: "Sam",
            excerpt: "Kick is loud",
            resolved: true,
            resolvedBy: "Alex",
          },
        ]}
        duration={120}
      />
    );

    fireEvent.focus(screen.getByRole("button"));

    expect(screen.getByText("Resolved · Alex")).toBeTruthy();
  });

  it("closes a resolved pin's note with a bare Resolved when nobody is named", () => {
    render(
      <WaveMarks
        marks={[
          {
            id: 1,
            positionMs: 30_000,
            excerpt: "Kick is loud",
            resolved: true,
          },
        ]}
        duration={120}
      />
    );

    fireEvent.focus(screen.getByRole("button"));

    expect(screen.getByText("Resolved")).toBeTruthy();
  });

  it("leaves an open pin's note without a resolved line", () => {
    render(
      <WaveMarks
        marks={[{ id: 1, positionMs: 30_000, excerpt: "Kick is loud" }]}
        duration={120}
      />
    );

    fireEvent.focus(screen.getByRole("button"));

    expect(screen.getByText("Kick is loud")).toBeTruthy();
    expect(screen.queryByText(/Resolved/)).toBeNull();
  });

  it("dismisses an open comment note on Escape and provides a coarse touch hit halo", async () => {
    render(
      <WaveMarks
        marks={[{ id: 1, positionMs: 30_000, excerpt: "Kick is loud" }]}
        duration={120}
      />,
      { wrapper: MotionProvider }
    );

    const pin = screen.getByRole("button");
    expect(pin.className).toContain("coarse:after:");

    fireEvent.focus(pin);
    expect(screen.getByText("Kick is loud")).toBeTruthy();

    fireEvent.keyDown(pin, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByText("Kick is loud")).toBeNull();
    });
  });
});

describe("playedBars", () => {
  it("counts the bars behind a playhead, rounding to the nearest bar", () => {
    expect(playedBars(0, 160)).toBe("0");
    expect(playedBars(0.5, 160)).toBe("80");
    expect(playedBars(0.004, 160)).toBe("1");
    expect(playedBars(1, 96)).toBe("96");
  });
});
