import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  type PatchCable,
  type PatchNode,
  layoutPatchbay,
} from "@workspace/ui/lib/patchbay";
import { Patchbay } from "./patchbay";
import { PatchbayControls } from "./patchbay-controls";

const scrollIntoView = mock<(options?: ScrollIntoViewOptions) => void>();

beforeEach(() => {
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(cleanup);

const sets: PatchNode[] = [
  { id: "s1", label: "Anthem", meta: "Track one", href: "/session/1" },
  { id: "s2", label: "Ballad" },
  { id: "s3", label: "Coda" },
];

const samples: PatchNode[] = [
  { id: "x.wav", label: "x.wav", meta: "Drums" },
  { id: "pipe|x.wav", label: "pipe|x.wav" },
];

const cables: PatchCable[] = [
  { left: "s2", right: "x.wav" },
  { left: "s3", right: "x.wav" },
  { left: "s1", right: "pipe|x.wav" },
  { left: "s3", right: "pipe|x.wav" },
];

const bay = (extra?: React.ReactNode) => (
  <PatchbayControls>
    <Patchbay
      layout={layoutPatchbay(sets, samples, cables)}
      leftHead="Sets"
      rightHead="Samples"
      summary="3 sets share 2 samples."
    />
    {extra}
  </PatchbayControls>
);

function renderBay(extra?: React.ReactNode) {
  const result = render(bay(extra));
  const root = result.container.querySelector<HTMLElement>("[data-pb-root]")!;
  return { ...result, root };
}

const node = (root: HTMLElement, id: string) =>
  [...root.querySelectorAll<HTMLElement>("[data-pb-node]")].find(
    (element) => element.getAttribute("data-pb-node") === id
  )!;
const cable = (root: HTMLElement, id: string) =>
  [...root.querySelectorAll("[data-pb-cable]")].find(
    (element) => element.getAttribute("data-pb-cable") === id
  )!;
const nodeOf = (element: Element | null) =>
  element!.closest<HTMLElement>("[data-pb-node]")!;
const hot = (element: Element) => element.hasAttribute("data-hot");
const lit = (root: HTMLElement, selector: string, attribute: string) =>
  [...root.querySelectorAll(`${selector}[data-hot]`)]
    .map((element) => element.getAttribute(attribute))
    .sort();
const litNodes = (root: HTMLElement) =>
  lit(root, "[data-pb-node]", "data-pb-node");
const litCables = (root: HTMLElement) =>
  lit(root, "[data-pb-cable]", "data-pb-cable");
const note = () => document.body.querySelector<HTMLElement>("body > .fixed");

const focus = (element: HTMLElement) => act(() => element.focus());
const blur = (element: HTMLElement) => act(() => element.blur());
const hover = (element: Element) =>
  fireEvent.pointerOver(element, { pointerType: "mouse" });

describe("PatchbayControls", () => {
  it("lights a hovered node, its cables and its neighbours, and dims the rest", () => {
    const { root } = renderBay();

    hover(node(root, "s2"));
    expect(root.hasAttribute("data-dim")).toBe(true);
    expect(litNodes(root)).toEqual(["s2", "x.wav"]);
    expect(litCables(root)).toEqual(["s2|x.wav"]);

    hover(node(root, "x.wav"));
    expect(litNodes(root)).toEqual(["s2", "s3", "x.wav"]);
    expect(litCables(root)).toEqual(["s2|x.wav", "s3|x.wav"]);
  });

  it("puts the lighting out when the pointer leaves, and ignores a touch passing over", () => {
    const { root, container } = renderBay();

    fireEvent.pointerOver(node(root, "s2"), { pointerType: "touch" });
    expect(root.hasAttribute("data-dim")).toBe(false);

    hover(node(root, "s2"));
    fireEvent.pointerLeave(container.firstElementChild!);
    expect(root.hasAttribute("data-dim")).toBe(false);
    expect(litNodes(root)).toEqual([]);
    expect(litCables(root)).toEqual([]);
  });

  it("matches a right node by the end of a cable, so a path holding a | lights only its own cables", () => {
    const { root } = renderBay();

    hover(node(root, "x.wav"));
    expect(hot(cable(root, "s1|pipe|x.wav"))).toBe(false);
    expect(hot(node(root, "s1"))).toBe(false);

    hover(node(root, "pipe|x.wav"));
    expect(litCables(root)).toEqual(["s1|pipe|x.wav", "s3|pipe|x.wav"]);
    expect(litNodes(root)).toEqual(["pipe|x.wav", "s1", "s3"]);
  });

  it("pins on a click, holds against hover, and lets go on a second click", () => {
    const { root, container } = renderBay();

    fireEvent.click(node(root, "s2"));
    expect(litNodes(root)).toEqual(["s2", "x.wav"]);

    hover(node(root, "s1"));
    expect(litNodes(root)).toEqual(["s2", "x.wav"]);
    fireEvent.pointerLeave(container.firstElementChild!);
    expect(litNodes(root)).toEqual(["s2", "x.wav"]);

    fireEvent.click(node(root, "s2"));
    expect(root.hasAttribute("data-dim")).toBe(false);
    expect(litNodes(root)).toEqual([]);
  });

  it("lets go on a second tap even though the tap focused the node", () => {
    const { root } = renderBay();

    // A touch focuses the node after its pointer is up, then clicks.
    focus(node(root, "s2"));
    fireEvent.click(node(root, "s2"));
    fireEvent.click(node(root, "s2"));
    expect(root.hasAttribute("data-dim")).toBe(false);
    expect(litNodes(root)).toEqual([]);
  });

  it("moves a pin to the node clicked next", () => {
    const { root } = renderBay();

    fireEvent.click(node(root, "s2"));
    fireEvent.click(node(root, "s1"));
    expect(litNodes(root)).toEqual(["pipe|x.wav", "s1"]);
  });

  it("clears a pin on Escape", () => {
    const { root } = renderBay();

    fireEvent.click(node(root, "s2"));
    fireEvent.keyDown(node(root, "s2"), { key: "Escape" });
    expect(root.hasAttribute("data-dim")).toBe(false);
    expect(litNodes(root)).toEqual([]);
  });

  it("lights a focused node and clears when focus leaves", () => {
    const { root } = renderBay();

    focus(node(root, "s2"));
    expect(litNodes(root)).toEqual(["s2", "x.wav"]);

    blur(node(root, "s2"));
    expect(root.querySelector("[data-hot]")).toBeNull();
    expect(root.hasAttribute("data-dim")).toBe(false);
  });

  it("lights a focused node after a mouse press that was released outside the drawing", () => {
    const { root } = renderBay();

    fireEvent.pointerDown(node(root, "s2"), {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
    });
    fireEvent.pointerUp(document.body, { pointerId: 1 });
    focus(node(root, "s3"));

    expect(litNodes(root)).toContain("s3");
  });

  it("keeps a pin lit after focus leaves", () => {
    const { root } = renderBay();

    fireEvent.click(node(root, "s2"));
    focus(node(root, "s3"));
    blur(node(root, "s3"));
    expect(litNodes(root)).toEqual(["s2", "x.wav"]);
  });

  it("makes a node without a link focusable, and a node with one focusable through its link", () => {
    const { root } = renderBay();

    expect(node(root, "s2").getAttribute("tabindex")).toBe("0");
    expect(node(root, "s1").hasAttribute("tabindex")).toBe(false);
    expect(node(root, "s1").querySelector("a")?.getAttribute("href")).toBe(
      "/session/1"
    );
  });

  it("steps focus with ] and [ down the left rail and then the right, and round again", () => {
    const { root } = renderBay();
    const link = node(root, "s1").querySelector("a")!;
    const order = [
      ...root.querySelectorAll('[data-pb-rail="left"] > li'),
      ...root.querySelectorAll('[data-pb-rail="right"] > li'),
    ].map((element) => element.getAttribute("data-pb-node"));
    expect(order).toHaveLength(5);

    focus(link);
    fireEvent.keyDown(link, { key: "]" });
    expect(document.activeElement).toBe(node(root, order[1]!));
    expect(litNodes(root)).toContain(order[1]!);

    fireEvent.keyDown(document.activeElement!, { key: "[" });
    expect(document.activeElement).toBe(link);

    fireEvent.keyDown(link, { key: "[" });
    expect(document.activeElement).toBe(node(root, order[4]!));
    fireEvent.keyDown(document.activeElement!, { key: "]" });
    expect(document.activeElement).toBe(link);

    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      behavior: "auto",
    });
  });

  it("carries a pin along as it steps", () => {
    const { root } = renderBay();

    fireEvent.click(node(root, "s1"));
    const link = node(root, "s1").querySelector("a")!;
    focus(link);
    fireEvent.keyDown(link, { key: "]" });
    const stepped = nodeOf(document.activeElement);
    expect(stepped).not.toBe(node(root, "s1"));
    expect(hot(stepped)).toBe(true);
    expect(hot(node(root, "s1"))).toBe(false);
  });

  it("does not step while typing", () => {
    const { root, getByLabelText } = renderBay(<input aria-label="Filter" />);

    const input = getByLabelText("Filter");
    focus(input);
    fireEvent.keyDown(input, { key: "]" });
    expect(document.activeElement).toBe(input);
    expect(root.querySelector("[data-hot]")).toBeNull();
  });

  it("shows the lit node's full label and meta in a note that follows the lit node", () => {
    const { root } = renderBay();
    expect(note()).toBeNull();

    focus(node(root, "x.wav"));
    expect(note()?.textContent).toBe("x.wavDrums");

    hover(node(root, "s2"));
    focus(node(root, "s2"));
    expect(note()?.textContent).toBe("Ballad");
  });

  it("keeps a node lit that Escape dismissed the note of", () => {
    const { root } = renderBay();

    focus(node(root, "x.wav"));
    fireEvent.keyDown(node(root, "x.wav"), { key: "Escape" });
    expect(hot(node(root, "x.wav"))).toBe(true);
  });

  it("clears the lighting a re-render of the drawing would otherwise keep", () => {
    const { root, rerender } = renderBay();

    hover(node(root, "s2"));
    fireEvent.pointerLeave(root.parentElement!);
    act(() => node(root, "s3").setAttribute("data-hot", ""));
    rerender(bay(<span />));

    expect(root.querySelector("[data-hot]")).toBeNull();
  });

  describe("on a coarse pointer", () => {
    const { matchMedia } = window;

    beforeEach(() => {
      window.matchMedia = ((query: string) => ({
        matches: query.includes("coarse"),
        media: query,
        addEventListener() {},
        removeEventListener() {},
      })) as unknown as typeof window.matchMedia;
    });

    afterEach(() => {
      window.matchMedia = matchMedia;
    });

    it("lights on a tap and names the node in a popover, not a floating note", async () => {
      const { root } = renderBay();

      hover(node(root, "s2"));
      expect(root.hasAttribute("data-dim")).toBe(false);

      fireEvent.click(node(root, "x.wav"));
      expect(litNodes(root)).toEqual(["s2", "s3", "x.wav"]);
      expect(note()).toBeNull();
      const popover = await waitFor(() => {
        const found = document.body.querySelector(
          '[data-slot="popover-content"]'
        );
        expect(found).not.toBeNull();
        return found!;
      });
      expect(popover.getAttribute("aria-label")).toBe("x.wav");
      expect(popover.textContent).toBe("x.wavDrums");
    });
  });
});
