import { Heatmap } from "@workspace/ui/components/heatmap";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";

afterEach(cleanup);

const days = [{ day: "2026-03-05", saves: 2, sessions: 0 }];
// Wednesday to Sunday, so the grid pads three cells back to the Sunday.
const from = new Date("2026-03-04T00:00:00Z");
const to = new Date("2026-03-09T00:00:00Z");

const CELL =
  "size-[11px] rounded-[2px] bg-[color-mix(in_oklab,var(--art)_calc(var(--level)*22%),var(--paper-sunk))]";
const PAD = '<i class="size-[11px]"></i>';
const dayCell = (day: string, saves: number, level: number) =>
  `<i title="${day}: ${saves} saves" style="--level: ${level};" class="${CELL}"></i>`;

const GRID_CELLS =
  PAD.repeat(3) +
  dayCell("2026-03-04", 0, 0) +
  dayCell("2026-03-05", 2, 2) +
  dayCell("2026-03-06", 0, 0) +
  dayCell("2026-03-07", 0, 0) +
  dayCell("2026-03-08", 0, 0);

const GRID_OPEN =
  '<div class="grid grid-flow-col grid-rows-7 gap-[3px]" style="grid-auto-columns: 11px;">';

describe("Heatmap week start", () => {
  const initials = (container: HTMLElement) =>
    [
      ...container.querySelectorAll(
        ".grid-rows-7.w-4 > span, .w-4.grid-rows-7 > span"
      ),
    ].map((span) => span.textContent);

  it("starts each column on Sunday by default", () => {
    const { container } = render(<Heatmap days={days} from={from} to={to} />);

    expect(initials(container)).toEqual(["", "M", "", "W", "", "F", ""]);
    expect(container.innerHTML).toContain(GRID_OPEN + PAD.repeat(3));
  });

  it("starts each column on Monday, padding back to it and relabelling the rows", () => {
    const { container } = render(
      <Heatmap days={days} from={from} to={to} weekStart={1} />
    );

    expect(initials(container)).toEqual(["", "T", "", "T", "", "S", ""]);
    // Wednesday is two days after Monday.
    expect(container.innerHTML).toContain(
      GRID_OPEN + PAD.repeat(2) + dayCell("2026-03-04", 0, 0)
    );
  });
});

describe("Heatmap grid markup", () => {
  it("renders the labelled grid exactly as before", () => {
    const { container } = render(<Heatmap days={days} from={from} to={to} />);

    const label =
      "font-sub text-micro tracking-[0.1em] uppercase text-ink-soft";
    const weekday = (letter: string) =>
      `<span class="flex h-[11px] items-center leading-none">${letter}</span>`;
    expect(container.innerHTML).toBe(
      '<div class="max-w-full overflow-x-auto"><div class="inline-flex flex-col gap-1">' +
        `<div class="grid gap-[3px] pl-5 ${label}" style="grid-template-columns: repeat(2, 11px);">` +
        '<span class="leading-none"></span><span class="leading-none">Mar</span></div>' +
        '<div class="flex gap-1">' +
        `<div class="grid w-4 grid-rows-7 gap-[3px] ${label}">` +
        weekday("") +
        weekday("M") +
        weekday("") +
        weekday("W") +
        weekday("") +
        weekday("F") +
        weekday("") +
        "</div>" +
        GRID_OPEN +
        GRID_CELLS +
        "</div></div></div></div>"
    );
  });

  it("renders the compact grid with no labels", () => {
    const { container } = render(
      <Heatmap days={days} from={from} to={to} compact />
    );

    expect(container.innerHTML).toBe(
      '<div class="max-w-full overflow-x-auto"><div class="inline-flex flex-col gap-1">' +
        '<div class="flex gap-1">' +
        GRID_OPEN +
        GRID_CELLS +
        "</div></div></div></div>"
    );
  });

  it("renders a selectable grid as buttons with the picked day outlined", () => {
    const { container } = render(
      <Heatmap
        days={days}
        from={from}
        to={to}
        compact
        selectedDay="2026-03-05"
        onSelectDay={() => {}}
      />
    );

    const button = (
      day: string,
      saves: number,
      level: number,
      picked = false
    ) =>
      `<button type="button" title="${day}: ${saves} saves" aria-label="${day}: ${saves} saves" aria-pressed="${picked}" style="--level: ${level};" class="${CELL}${picked ? " outline-1 outline-offset-1 outline-art" : ""}"></button>`;
    expect(container.innerHTML).toBe(
      '<div class="max-w-full overflow-x-auto"><div class="inline-flex flex-col gap-1">' +
        '<div class="flex gap-1">' +
        GRID_OPEN +
        PAD.repeat(3) +
        button("2026-03-04", 0, 0) +
        button("2026-03-05", 2, 2, true) +
        button("2026-03-06", 0, 0) +
        button("2026-03-07", 0, 0) +
        button("2026-03-08", 0, 0) +
        "</div></div></div></div>"
    );
  });
});

describe("Heatmap strip", () => {
  it("renders exactly the window's days in one row with no padding cell", () => {
    const { container } = render(
      <Heatmap days={days} from={from} to={to} layout="strip" />
    );

    const cells = container.querySelectorAll("[title]");
    expect(Array.from(cells, (cell) => cell.getAttribute("title"))).toEqual([
      "2026-03-04: 0 saves",
      "2026-03-05: 2 saves",
      "2026-03-06: 0 saves",
      "2026-03-07: 0 saves",
      "2026-03-08: 0 saves",
    ]);
    expect(container.querySelectorAll("i")).toHaveLength(5);
    expect(container.querySelector(".grid-rows-1")).not.toBeNull();
    expect(container.querySelector(".grid-rows-7")).toBeNull();
  });

  it("draws no month row and no weekday column", () => {
    const { container } = render(
      <Heatmap days={days} from={from} to={to} layout="strip" />
    );

    expect(container.textContent).toBe("");
  });

  it("keeps each cell's level colour", () => {
    const { container } = render(
      <Heatmap days={days} from={from} to={to} layout="strip" />
    );

    const levels = Array.from(container.querySelectorAll("i"), (cell) =>
      cell.style.getPropertyValue("--level")
    );
    expect(levels).toEqual(["0", "2", "0", "0", "0"]);
  });

  it("makes the cells buttons when a day can be selected", () => {
    const picked: string[] = [];
    const { container } = render(
      <Heatmap
        days={days}
        from={from}
        to={to}
        layout="strip"
        selectedDay="2026-03-05"
        onSelectDay={(day) => picked.push(day)}
      />
    );

    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(5);
    expect(buttons[1]?.getAttribute("aria-pressed")).toBe("true");
    buttons[3]?.click();
    expect(picked).toEqual(["2026-03-07"]);
  });
});

describe("Heatmap sweep", () => {
  const sweepCells = (container: HTMLElement) =>
    Array.from(container.querySelectorAll(".heatmap__cell--sweep"));

  it("indexes each dated cell and counts them on the strip", () => {
    const { container } = render(
      <Heatmap days={days} from={from} to={to} layout="strip" sweep />
    );

    expect(
      sweepCells(container).map((cell) =>
        (cell as HTMLElement).style.getPropertyValue("--i")
      )
    ).toEqual(["0", "1", "2", "3", "4"]);
    const row = container.querySelector(".grid-rows-1") as HTMLElement;
    expect(row.style.getPropertyValue("--n")).toBe("5");
  });

  it("starts the grid's stagger at its first dated cell, past the padding", () => {
    const { container } = render(
      <Heatmap days={days} from={from} to={to} sweep />
    );

    expect(container.querySelectorAll("i")).toHaveLength(8);
    expect(sweepCells(container)).toHaveLength(5);
    expect(
      sweepCells(container).map((cell) =>
        (cell as HTMLElement).style.getPropertyValue("--i")
      )
    ).toEqual(["0", "1", "2", "3", "4"]);
    const grid = container.querySelector(".grid-flow-col") as HTMLElement;
    expect(grid.style.getPropertyValue("--n")).toBe("5");
  });

  it("puts the sweep on selectable cells too", () => {
    const { container } = render(
      <Heatmap
        days={days}
        from={from}
        to={to}
        layout="strip"
        sweep
        onSelectDay={() => {}}
      />
    );

    expect(
      container.querySelectorAll("button.heatmap__cell--sweep")
    ).toHaveLength(5);
  });

  it("renders no index, count or class without it", () => {
    for (const layout of ["strip", "grid"] as const) {
      const { container, unmount } = render(
        <Heatmap days={days} from={from} to={to} layout={layout} />
      );

      expect(container.innerHTML).not.toContain("--i");
      expect(container.innerHTML).not.toContain("--n");
      expect(container.innerHTML).not.toContain("heatmap__cell--sweep");
      unmount();
    }
  });
});
