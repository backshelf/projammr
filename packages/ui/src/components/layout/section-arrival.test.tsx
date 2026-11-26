import { CanvasRootProvider } from "@workspace/ui/components/layout/scroll-root";
import { SectionArrival } from "@workspace/ui/components/layout/section-arrival";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { useRef, type ReactNode } from "react";

/**
 * happy-dom measures every element as a zero-size box at the origin, so the
 * two boxes the component compares say where they are by tag: the canvas ends
 * at 800, and the section starts wherever the test puts it.
 */
const CANVAS_BOTTOM = 800;
const measured = Element.prototype.getBoundingClientRect;

function placeSectionAt(top: number) {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const box =
      this.tagName === "SECTION"
        ? { top, bottom: top }
        : { top: 0, bottom: CANVAS_BOTTOM };
    return box as DOMRect;
  };
}

/**
 * The preload's observer reports every element as reached; this one waits for
 * {@link reachTheSection}, so the moment the reader arrives is the test's to
 * choose and the waiting state can be read before it.
 */
const watched: { target: Element; report: IntersectionObserverCallback }[] = [];
const preloadedObserver = globalThis.IntersectionObserver;

globalThis.IntersectionObserver = class {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    watched.push({ target, report: this.callback });
  }
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver;

const reachTheSection = () =>
  act(() => {
    for (const { target, report } of watched) {
      report(
        [{ target, isIntersecting: true } as IntersectionObserverEntry],
        null as unknown as IntersectionObserver
      );
    }
  });

afterEach(() => {
  watched.length = 0;
  Element.prototype.getBoundingClientRect = measured;
  cleanup();
});

afterAll(() => {
  globalThis.IntersectionObserver = preloadedObserver;
});

function Canvas({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <MotionProvider>
      <div ref={ref}>
        <CanvasRootProvider containerRef={ref}>{children}</CanvasRootProvider>
      </div>
    </MotionProvider>
  );
}

function renderSection(top: number) {
  placeSectionAt(top);
  const { container } = render(
    <Canvas>
      <SectionArrival>
        <p>{"four sessions"}</p>
      </SectionArrival>
    </Canvas>
  );
  return container.querySelector("section") as HTMLElement;
}

describe("SectionArrival", () => {
  it("leaves a section inside the canvas at rest", async () => {
    const section = renderSection(200);

    expect(section.hasAttribute("data-arrival")).toBe(false);
    expect(section.style.opacity).toBe("1");
    expect(section.style.transform).toBe("none");

    await reachTheSection();
    expect(section.hasAttribute("data-arrival")).toBe(false);
  });

  it("holds a section below the fold back until the reader reaches it", async () => {
    const section = renderSection(CANVAS_BOTTOM + 400);

    await waitFor(() => expect(section.style.opacity).toBe("0"));
    expect(section.getAttribute("data-arrival")).toBe("waiting");
    expect(section.style.transform).toBe("translateY(12px)");

    await reachTheSection();
    expect(section.hasAttribute("data-arrival")).toBe(false);
  });
});
