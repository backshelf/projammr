import type { PeekPanelProps } from "@/components/tables/PeekPanel";
import type { Row } from "@/components/tables/test-support";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { useEffect } from "react";

// The panel has its own suite. Standing in for it keeps this one on what the
// part decides: when the panel mounts, what it is handed and that it stays.
// The chunk is still fetched through the part's own `next/dynamic`.
const mounts = { count: 0 };
mock.module("@/components/tables/PeekPanel", () => ({
  PeekPanel: (props: PeekPanelProps) => {
    useEffect(() => {
      mounts.count += 1;
    }, []);
    return (
      <div data-testid="peek-panel">
        <span data-testid="peek-title">{props.row?.title ?? "none"}</span>
        <span data-testid="peek-position">
          {props.position
            ? `${props.position.index} / ${props.position.total}`
            : "none"}
        </span>
        <button aria-label="Close panel" onClick={props.onClose} />
        <button
          aria-label="Previous row"
          disabled={!props.onPrevious}
          onClick={props.onPrevious ?? undefined}
        />
        <button
          aria-label="Next row"
          disabled={!props.onNext || Boolean(props.nextLoading)}
          onClick={props.onNext ?? undefined}
        />
        <span data-testid="peek-next-loading">
          {props.nextLoading ? "loading" : "idle"}
        </span>
      </div>
    );
  },
}));

const { deferredLoad, renderGrid } =
  await import("@/components/tables/test-support");

const LOADED = 30;

function rowsOf(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    title: `Track ${index + 1}`,
    statusId: null,
    genre: "Rock",
    mastered: false,
    notes: "",
  }));
}

/** `count` fixture rows with ids starting at `from`, for a second page. */
function rowsFrom(count: number, from: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: from + index,
    title: `Track ${from + index}`,
    statusId: null,
    genre: "Rock",
    mastered: false,
    notes: "",
  }));
}

// happy-dom starts on about:blank, where `history.replaceState` is ignored, so
// the location is set through the window's own controller.
type HappyWindow = { happyDOM: { setURL(url: string): void } };
const happyDOM = (window as unknown as HappyWindow).happyDOM;
const START_URL = window.location.href;

function locate(search: string) {
  happyDOM.setURL(`http://localhost/project/1/tracks${search}`);
}

const peek = {
  toPeekRow: (row: Row) => ({ id: row.id, title: row.title }),
  href: (row: Row) => `/track/${row.id}`,
  titleField: "title",
};

/**
 * Renders a table that holds every row, with the peek param already in the
 * URL. The table adopts it once it has hydrated, which is how a deep link
 * opens.
 */
async function renderPeeked(
  peekId: number | null,
  overrides: Parameters<typeof renderGrid>[2] = {}
) {
  if (peekId != null) locate(`?peek=${peekId}`);
  const result = renderGrid(undefined, undefined, {
    data: rowsOf(LOADED),
    persistStateInUrl: true,
    peek,
    ...overrides,
  });
  await act(async () => {});
  return result;
}

const LABEL = {
  Close: "Close panel",
  Previous: "Previous row",
  Next: "Next row",
};
const control = (which: keyof typeof LABEL) =>
  screen.getByRole<HTMLButtonElement>("button", { name: LABEL[which] });

const click = (which: keyof typeof LABEL) =>
  act(async () => {
    fireEvent.click(control(which));
  });

const isDisabled = (which: keyof typeof LABEL) => control(which).disabled;

beforeEach(() => {
  mounts.count = 0;
});

afterEach(() => happyDOM.setURL(START_URL));

describe("Peek", () => {
  it("shows the panel for a row once its chunk resolves", async () => {
    await renderPeeked(3);

    expect((await screen.findByTestId("peek-title")).textContent).toBe(
      "Track 3"
    );
    expect(screen.getByTestId("peek-position").textContent).toBe(
      `3 / ${LOADED}`
    );
  });

  it("renders nothing while no row has ever been opened", async () => {
    await renderPeeked(null);

    expect(screen.queryByTestId("peek-panel")).toBeNull();
    expect(mounts.count).toBe(0);
  });

  it("stops going back at the first row", async () => {
    await renderPeeked(1);
    await screen.findByTestId("peek-panel");

    expect(isDisabled("Previous")).toBe(true);
    expect(isDisabled("Next")).toBe(false);
  });

  it("stops going forward at the last loaded row", async () => {
    await renderPeeked(LOADED);
    await screen.findByTestId("peek-panel");

    expect(isDisabled("Next")).toBe(true);
    expect(isDisabled("Previous")).toBe(false);

    await click("Previous");

    expect(screen.getByTestId("peek-title").textContent).toBe(
      `Track ${LOADED - 1}`
    );
    expect(isDisabled("Next")).toBe(false);
  });

  it("keeps the panel mounted, without mounting it again, after it closes", async () => {
    await renderPeeked(2);
    const panel = await screen.findByTestId("peek-panel");
    expect(mounts.count).toBe(1);

    await click("Close");

    expect(screen.getByTestId("peek-panel")).toBe(panel);
    expect(screen.getByTestId("peek-title").textContent).toBe("none");

    locate("?peek=4");
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(screen.getByTestId("peek-panel")).toBe(panel);
    expect(screen.getByTestId("peek-title").textContent).toBe("Track 4");
    expect(mounts.count).toBe(1);
  });

  it("never renders the panel on a table without a peek config", async () => {
    await renderPeeked(3, { peek: undefined });

    expect(screen.queryByTestId("peek-panel")).toBeNull();
    expect(mounts.count).toBe(0);
  });
});

describe("Peek: next past the loaded window", () => {
  const nextLoading = () => screen.getByTestId("peek-next-loading").textContent;

  it("loads the next page, then steps once it lands", async () => {
    const { load, calls, settle } = deferredLoad();
    await renderPeeked(LOADED, {
      serverPage: { rowCount: LOADED + 1, load },
    });
    await screen.findByTestId("peek-panel");

    // One more row exists past the window, so Next is enabled rather than
    // clamped, and loads the page instead of doing nothing.
    expect(isDisabled("Next")).toBe(false);

    await click("Next");

    expect(nextLoading()).toBe("loading");
    expect(isDisabled("Next")).toBe(true);
    expect(screen.getByTestId("peek-title").textContent).toBe(
      `Track ${LOADED}`
    );

    await settle(calls[0], {
      rows: rowsFrom(1, LOADED + 1),
      rowCount: LOADED + 1,
      pageSize: LOADED + 1,
    });
    await act(async () => {});

    expect(nextLoading()).toBe("idle");
    expect(screen.getByTestId("peek-title").textContent).toBe(
      `Track ${LOADED + 1}`
    );
    // The server holds nothing past the row just landed on.
    expect(isDisabled("Next")).toBe(true);
  });

  it("stays on the current row when the load fails", async () => {
    const { load, calls, settle } = deferredLoad();
    await renderPeeked(LOADED, {
      serverPage: { rowCount: LOADED + 5, load },
    });
    await screen.findByTestId("peek-panel");

    await click("Next");
    await settle(calls[0]);
    await act(async () => {});

    expect(nextLoading()).toBe("idle");
    expect(screen.getByTestId("peek-title").textContent).toBe(
      `Track ${LOADED}`
    );
  });
});
