import { ScrollRoot } from "@workspace/ui/components/layout/scroll-root";
import { stubGlobal, unstubAllGlobals } from "@workspace/test/globals";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";

/**
 * happy-dom keeps `scrollTop` as a free number and reports every box as zero
 * high, so the container is given a browser's geometry: a settable offset the
 * setter clamps to the scrollable distance, over a content height the test
 * chooses. Growth is what a streamed section does to the page, and the clamp
 * is what makes a restore land short of its target.
 */
const page = { scrollHeight: 2000, clientHeight: 800 };
const offsets = new WeakMap<HTMLElement, number>();
const measured = {
  scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop"),
  scrollHeight: Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollHeight"
  ),
  clientHeight: Object.getOwnPropertyDescriptor(
    Element.prototype,
    "clientHeight"
  ),
};

Object.defineProperties(Element.prototype, {
  scrollHeight: { configurable: true, get: () => page.scrollHeight },
  clientHeight: { configurable: true, get: () => page.clientHeight },
  scrollTop: {
    configurable: true,
    get(this: HTMLElement) {
      return offsets.get(this) ?? 0;
    },
    set(this: HTMLElement, value: number) {
      const furthest = Math.max(0, page.scrollHeight - page.clientHeight);
      offsets.set(this, Math.max(0, Math.min(value, furthest)));
    },
  },
});

/**
 * happy-dom's own ResizeObserver never calls back, so growth is reported by
 * the test: {@link growTo} raises the page and tells whoever is watching.
 */
const watchers: ResizeObserverCallback[] = [];

globalThis.ResizeObserver = class {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    watchers.push(this.callback);
  }
  unobserve() {}
  disconnect() {
    watchers.splice(watchers.indexOf(this.callback), 1);
  }
} as unknown as typeof ResizeObserver;

function growTo(scrollHeight: number) {
  page.scrollHeight = scrollHeight;
  for (const report of [...watchers]) {
    report([], null as unknown as ResizeObserver);
  }
}

afterEach(() => {
  cleanup();
  watchers.length = 0;
  sessionStorage.clear();
  window.history.replaceState({}, "");
  unstubAllGlobals();
  page.scrollHeight = 2000;
  page.clientHeight = 800;
});

process.on("exit", () => {
  for (const [name, descriptor] of Object.entries(measured)) {
    if (descriptor) Object.defineProperty(Element.prototype, name, descriptor);
  }
});

/** The rAF the scroll listener throttles its save onto. */
const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function mount() {
  const { container } = render(
    <ScrollRoot>
      <div>{"the page"}</div>
    </ScrollRoot>
  );
  return container.firstElementChild as HTMLElement;
}

/** The notebook's shape: two containers standing on one history entry. */
function mountPanes() {
  const { container } = render(
    <>
      <ScrollRoot pane="notes">
        <div>{"the list"}</div>
      </ScrollRoot>
      <ScrollRoot pane="note">
        <div>{"the note"}</div>
      </ScrollRoot>
    </>
  );
  return [...container.children] as HTMLElement[];
}

async function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top;
  el.dispatchEvent(new Event("scroll"));
  await frame();
  return el;
}

/** The stamp the hook puts on a history entry the Navigation API has no key for. */
const stamp = () => (window.history.state as Record<string, unknown>).__pjEntry;

describe("useScrollRestoration", () => {
  it("restores the saved offset before the first paint", async () => {
    await scrollTo(mount(), 500);
    cleanup();

    expect(mount().scrollTop).toBe(500);
  });

  it("keeps the same stamp after Next drops it", async () => {
    const el = await scrollTo(mount(), 500);
    const original = stamp();
    expect(typeof original).toBe("string");

    window.history.replaceState({ __NA: true }, "");
    await scrollTo(el, 520);

    expect(stamp()).toBe(original);
    expect((window.history.state as { __NA?: boolean }).__NA).toBe(true);
    cleanup();
    expect(mount().scrollTop).toBe(520);
  });

  it("does not restore a second forward visit", async () => {
    await scrollTo(mount(), 500);
    cleanup();

    window.history.replaceState({}, "");
    expect(mount().scrollTop).toBe(0);
  });

  it("clamps, then reaches the target when content grows", async () => {
    await scrollTo(mount(), 500);
    cleanup();

    page.scrollHeight = 900;
    const el = mount();
    expect(el.scrollTop).toBe(100);

    growTo(2000);
    expect(el.scrollTop).toBe(500);
  });

  it("stops retrying after a gesture", async () => {
    await scrollTo(mount(), 500);
    cleanup();

    page.scrollHeight = 900;
    const el = mount();
    window.dispatchEvent(new Event("touchstart"));

    growTo(2000);
    expect(el.scrollTop).toBe(100);
  });

  it("keeps a separate offset per named pane", async () => {
    const [list, note] = mountPanes();

    await scrollTo(list!, 300);
    await scrollTo(note!, 700);
    cleanup();

    expect(mountPanes().map((el) => el.scrollTop)).toEqual([300, 700]);
  });

  it("prefers the Navigation API key", async () => {
    const entry = { key: "k1" };
    stubGlobal("navigation", { currentEntry: entry });

    await scrollTo(mount(), 500);
    expect(stamp()).toBeUndefined();
    cleanup();

    entry.key = "k2";
    expect(mount().scrollTop).toBe(0);
    cleanup();

    entry.key = "k1";
    expect(mount().scrollTop).toBe(500);
  });
});
